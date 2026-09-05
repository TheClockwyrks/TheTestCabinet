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
 * and a system with turbulence on could pin a browser tab at a couple of frames a
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
/**
 * A curl-noise field with a memoized lattice. Hold one per simulator: the memo is
 * per-instance state, and the field it caches is the same for every particle in a
 * system, so sharing it across the whole play is exactly the point.
 */
export declare class CurlNoise {
    /** The lattice coordinate each occupied slot holds, `[x, y, z]` per slot. */
    private readonly keys;
    /** The hashed lattice value per slot. */
    private readonly values;
    /** Whether a slot holds anything, so `(0, 0, 0)` is a usable key. */
    private readonly filled;
    /**
     * The curl-noise acceleration at a world position, with the field sampled at spatial
     * frequency `scaleFreq`.
     */
    sample(pos: Vec3, scaleFreq: number): Vec3;
    /**
     * The central difference of one potential channel (identified by its `offset`) along
     * `axis`, at the noise-space point `(px, py, pz)`.
     */
    private difference;
    /**
     * A smooth pseudo-random scalar field in `[-1, 1]`, trilinearly interpolating the
     * memoized hash lattice.
     */
    private valueNoise;
    /**
     * The hash at one integer lattice corner, memoized. A slot holding a different
     * corner is simply overwritten — the stored key is compared before a hit is
     * returned, so a collision costs one recompute and never a wrong value.
     */
    private lattice;
}
/** A hash of integer lattice coordinates to `[-1, 1]` (mirrors `sim.rs`). */
export declare function hash3(x: number, y: number, z: number): number;
//# sourceMappingURL=noise.d.ts.map