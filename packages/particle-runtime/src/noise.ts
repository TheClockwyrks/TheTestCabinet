/**
 * The curl-noise turbulence field the simulator integrates as a force — the browser
 * port of `particle-core`'s `curl_noise` (`sim.rs`), and by a wide margin the most
 * expensive thing the runtime does per particle.
 *
 * The field is the curl of a hash-based vector potential, approximated by central
 * differences. Evaluated naively that is 12 value-noise samples per particle per
 * frame, each trilerping 8 lattice corners, each corner a SplitMix64 hash carried in
 * `BigInt` to stay exact — about 400 wrapping 64-bit multiplies for a single
 * particle's turbulence, every frame. Native Rust absorbs that; JavaScript does not,
 * and a system with turbulence on could pin a review tab at a couple of frames a
 * second while its preview GIF played perfectly.
 *
 * Two properties rescue it, and neither changes a single output value:
 *
 * - **The lattice is tiny and shared.** The hashes depend only on *integer* lattice
 *   coordinates, so across a field's worth of particles the same few hundred corners
 *   are hashed again and again — and the field is time-invariant, so a corner hashed
 *   once is valid for the rest of the play. {@link CurlNoise} memoizes them in a
 *   fixed-size open-addressed table: bounded memory, no allocation, and every hit
 *   verified against its stored key, so a collision costs a recompute rather than a
 *   wrong value.
 * - **A third of the samples were discarded.** The curl of a 3-vector potential needs
 *   only two of each partial derivative's three components; the straightforward
 *   `potential(p ± e)` formulation computes all three and throws the rest away. Taking
 *   only the six components the curl reads drops 18 value-noise samples to 12.
 *
 * The result is arithmetically identical to the naive form — same lattice hashes, same
 * differences, same order of operations — so a seeded play still matches the binary's.
 */

import type { Vec3 } from "./contract";
import { asU64, rotl64, splitmix64 } from "./rng";

/**
 * Slots in the lattice memo (a power of two, so the slot index is a mask). A field's
 * worth of turbulence touches a few hundred to a few thousand corners, so this is
 * generous enough that collisions are rare, at 1.5 MB of fixed footprint.
 */
const CACHE_SLOTS = 1 << 17;

/** The half-width of the central difference, in noise space (mirrors `sim.rs`). */
const EPSILON = 0.1;

/** The fixed offsets the three potential channels are sampled at (mirrors `sim.rs`). */
const CHANNEL_2: Vec3 = [31.4, 17.2, 4.7];
const CHANNEL_3: Vec3 = [7.1, 23.9, 55.3];

/**
 * The largest lattice coordinate the memo will key on. Beyond it the packed key would
 * not survive an `Int32Array`, so those corners (a particle flung absurdly far, or a
 * turbulence scale so high the lattice outruns the field) are hashed uncached.
 */
const MAX_CACHEABLE = 1 << 29;

/**
 * A curl-noise field with a memoized lattice. Hold one per simulator: the memo is
 * per-instance state, and the field it caches is the same for every particle in a
 * system, so sharing it across the whole play is exactly the point.
 */
export class CurlNoise {
  /** The lattice coordinate each occupied slot holds, `[x, y, z]` per slot. */
  private readonly keys = new Int32Array(CACHE_SLOTS * 3);
  /** The hashed lattice value per slot. */
  private readonly values = new Float32Array(CACHE_SLOTS);
  /** Whether a slot holds anything, so `(0, 0, 0)` is a usable key. */
  private readonly filled = new Uint8Array(CACHE_SLOTS);

  /**
   * The curl-noise acceleration at a world position, with the field sampled at spatial
   * frequency `scaleFreq`.
   */
  sample(pos: Vec3, scaleFreq: number): Vec3 {
    const px = pos[0] * scaleFreq;
    const py = pos[1] * scaleFreq;
    const pz = pos[2] * scaleFreq;

    // The six partial derivatives the curl actually reads. Each is a central
    // difference of one potential channel along one axis; the channel offsets are
    // added in the same order as the naive form so the arithmetic is identical.
    const c1dy = this.difference(px, py, pz, 1, ORIGIN);
    const c1dz = this.difference(px, py, pz, 2, ORIGIN);
    const c2dx = this.difference(px, py, pz, 0, CHANNEL_2);
    const c2dz = this.difference(px, py, pz, 2, CHANNEL_2);
    const c3dx = this.difference(px, py, pz, 0, CHANNEL_3);
    const c3dy = this.difference(px, py, pz, 1, CHANNEL_3);

    const inv = 1 / (2 * EPSILON);
    return [(c3dy - c2dz) * inv, (c1dz - c3dx) * inv, (c2dx - c1dy) * inv];
  }

  /**
   * The central difference of one potential channel (identified by its `offset`) along
   * `axis`, at the noise-space point `(px, py, pz)`.
   */
  private difference(
    px: number,
    py: number,
    pz: number,
    axis: 0 | 1 | 2,
    offset: Vec3,
  ): number {
    const ax = axis === 0 ? EPSILON : 0;
    const ay = axis === 1 ? EPSILON : 0;
    const az = axis === 2 ? EPSILON : 0;
    return (
      this.valueNoise(px + ax + offset[0], py + ay + offset[1], pz + az + offset[2]) -
      this.valueNoise(px - ax + offset[0], py - ay + offset[1], pz - az + offset[2])
    );
  }

  /**
   * A smooth pseudo-random scalar field in `[-1, 1]`, trilinearly interpolating the
   * memoized hash lattice.
   */
  private valueNoise(x: number, y: number, z: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const zf = smooth(z - zi);

    const c00 = lerp(this.lattice(xi, yi, zi), this.lattice(xi + 1, yi, zi), xf);
    const c10 = lerp(this.lattice(xi, yi + 1, zi), this.lattice(xi + 1, yi + 1, zi), xf);
    const c01 = lerp(this.lattice(xi, yi, zi + 1), this.lattice(xi + 1, yi, zi + 1), xf);
    const c11 = lerp(
      this.lattice(xi, yi + 1, zi + 1),
      this.lattice(xi + 1, yi + 1, zi + 1),
      xf,
    );
    return lerp(lerp(c00, c10, yf), lerp(c01, c11, yf), zf);
  }

  /**
   * The hash at one integer lattice corner, memoized. A slot holding a different
   * corner is simply overwritten — the stored key is compared before a hit is
   * returned, so a collision costs one recompute and never a wrong value.
   */
  private lattice(x: number, y: number, z: number): number {
    if (
      x <= -MAX_CACHEABLE ||
      x >= MAX_CACHEABLE ||
      y <= -MAX_CACHEABLE ||
      y >= MAX_CACHEABLE ||
      z <= -MAX_CACHEABLE ||
      z >= MAX_CACHEABLE
    ) {
      return hash3(x, y, z);
    }
    const slot = slotOf(x, y, z);
    const key = slot * 3;
    if (
      this.filled[slot] === 1 &&
      this.keys[key] === x &&
      this.keys[key + 1] === y &&
      this.keys[key + 2] === z
    ) {
      return this.values[slot]!;
    }
    const value = hash3(x, y, z);
    this.keys[key] = x;
    this.keys[key + 1] = y;
    this.keys[key + 2] = z;
    this.values[slot] = value;
    this.filled[slot] = 1;
    return value;
  }
}

/** The unshifted first potential channel. */
const ORIGIN: Vec3 = [0, 0, 0];

/** Which memo slot a lattice corner lands in — a cheap 32-bit spatial hash. */
function slotOf(x: number, y: number, z: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h & (CACHE_SLOTS - 1);
}

/** A hash of integer lattice coordinates to `[-1, 1]` (mirrors `sim.rs`). */
export function hash3(x: number, y: number, z: number): number {
  let h =
    splitmix64(asU64(x)) ^
    rotl64(splitmix64(asU64(y)), 21n) ^
    rotl64(splitmix64(asU64(z)), 42n);
  h = splitmix64(h & ((1n << 64n) - 1n));
  return (Number(h >> 40n) / (1 << 24)) * 2 - 1;
}

/** A smoothstep fade for lattice interpolation. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
