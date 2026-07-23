import { describe, expect, it } from "vitest";
import type { Vec3 } from "./contract";
import { CurlNoise, hash3 } from "./noise";

/**
 * The naive curl-noise formulation this module replaces, kept verbatim as the oracle:
 * three full potential evaluations differenced along each axis (18 value-noise
 * samples), every lattice corner hashed fresh. {@link CurlNoise} must agree with it
 * exactly — not approximately — since a seeded browser play is meant to match the
 * binary's own simulation.
 */
function referenceCurlNoise(pos: Vec3, scaleFreq: number): Vec3 {
  const p: Vec3 = [pos[0] * scaleFreq, pos[1] * scaleFreq, pos[2] * scaleFreq];
  const e = 0.1;
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const potential = (q: Vec3): Vec3 => [
    valueNoise(q),
    valueNoise([q[0] + 31.4, q[1] + 17.2, q[2] + 4.7]),
    valueNoise([q[0] + 7.1, q[1] + 23.9, q[2] + 55.3]),
  ];
  const dx = sub(potential([p[0] + e, p[1], p[2]]), potential([p[0] - e, p[1], p[2]]));
  const dy = sub(potential([p[0], p[1] + e, p[2]]), potential([p[0], p[1] - e, p[2]]));
  const dz = sub(potential([p[0], p[1], p[2] + e]), potential([p[0], p[1], p[2] - e]));
  const inv = 1 / (2 * e);
  return [(dy[2] - dz[1]) * inv, (dz[0] - dx[2]) * inv, (dx[1] - dy[0]) * inv];
}

function valueNoise(p: Vec3): number {
  const xi = Math.floor(p[0]);
  const yi = Math.floor(p[1]);
  const zi = Math.floor(p[2]);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const xf = smooth(p[0] - xi);
  const yf = smooth(p[1] - yi);
  const zf = smooth(p[2] - zi);
  const corner = (dx: number, dy: number, dz: number): number =>
    hash3(xi + dx, yi + dy, zi + dz);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c00 = lerp(corner(0, 0, 0), corner(1, 0, 0), xf);
  const c10 = lerp(corner(0, 1, 0), corner(1, 1, 0), xf);
  const c01 = lerp(corner(0, 0, 1), corner(1, 0, 1), xf);
  const c11 = lerp(corner(0, 1, 1), corner(1, 1, 1), xf);
  return lerp(lerp(c00, c10, yf), lerp(c01, c11, yf), zf);
}

/** A spread of sample positions: inside a field, off-origin, negative, and far out. */
const POSITIONS: Vec3[] = [
  [0, 0, 0],
  [1, 1, 1],
  [24, 62, 16],
  [23.75, 4.5, 31.25],
  [-12.5, -3.25, -40],
  [0.0001, 128.5, -0.75],
  [4096, -8192, 512.5],
];

const SCALES = [0.01, 0.15, 1, 7.5];

describe("CurlNoise", () => {
  it("matches the naive 18-sample formulation exactly", () => {
    const noise = new CurlNoise();
    for (const scale of SCALES) {
      for (const pos of POSITIONS) {
        expect(noise.sample(pos, scale)).toEqual(referenceCurlNoise(pos, scale));
      }
    }
  });

  it("returns the same value from a warm lattice as from a cold one", () => {
    const cold = new CurlNoise();
    const warm = new CurlNoise();
    // Warm the memo over a swathe of the field first, so the second read of a corner
    // comes from the table rather than the hash.
    for (let x = 0; x < 48; x += 1.5) {
      for (let y = 0; y < 64; y += 2) {
        warm.sample([x, y, 16], 0.15);
      }
    }
    for (const pos of POSITIONS) {
      expect(warm.sample(pos, 0.15)).toEqual(cold.sample(pos, 0.15));
    }
    // And a repeat read of an already-cached position is stable.
    expect(warm.sample([24, 62, 16], 0.15)).toEqual(warm.sample([24, 62, 16], 0.15));
  });

  it("stays exact at lattice coordinates too large to memoize", () => {
    // Past the cacheable range the corners are hashed uncached; the values must not
    // change because of it.
    const noise = new CurlNoise();
    const far: Vec3 = [1e12, -1e12, 5e11];
    expect(noise.sample(far, 1)).toEqual(referenceCurlNoise(far, 1));
  });

  it("is a smooth field: nearby positions give nearby forces", () => {
    const noise = new CurlNoise();
    const a = noise.sample([12, 20, 8], 0.15);
    const b = noise.sample([12.01, 20, 8], 0.15);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.5);
    }
  });
});
