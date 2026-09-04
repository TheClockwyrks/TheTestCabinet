// The seeded generator is the whole of Carom's randomness, and
// `specs/instrumentation.md` requires that reseeding and replaying reproduce a
// scenario exactly — so what is checked here is reproducibility, not the
// statistics of the draw.

import { describe, expect, it } from "vitest";
import { nextAngle, nextRandom, seedRandom, type RandomSource } from "./rng";

function draws(seed: number, count: number): number[] {
  const source: RandomSource = { seed, rngState: seed };
  return Array.from({ length: count }, () => nextRandom(source));
}

describe("nextRandom", () => {
  it("replays the same sequence from the same seed", () => {
    expect(draws(1, 8)).toEqual(draws(1, 8));
    expect(draws(1234, 8)).toEqual(draws(1234, 8));
  });

  it("gives a different sequence from a different seed", () => {
    expect(draws(1, 8)).not.toEqual(draws(2, 8));
  });

  it("stays inside [0, 1)", () => {
    for (const value of draws(99, 200)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("advances the source's state", () => {
    const source: RandomSource = { seed: 7, rngState: 7 };
    nextRandom(source);
    expect(source.rngState).not.toBe(7);
    expect(Number.isInteger(source.rngState)).toBe(true);
  });
});

describe("seedRandom", () => {
  it("puts both the seed and the generator's state at the seed given", () => {
    const source: RandomSource = { seed: 0, rngState: 999 };
    seedRandom(source, 42);
    expect(source.seed).toBe(42);
    expect(source.rngState).toBe(42);
  });

  it("replays the same draws after reseeding to the same value", () => {
    const source: RandomSource = { seed: 0, rngState: 0 };
    seedRandom(source, 12);
    const first = [nextRandom(source), nextRandom(source)];
    seedRandom(source, 12);
    expect([nextRandom(source), nextRandom(source)]).toEqual(first);
  });
});

describe("nextAngle", () => {
  it("stays inside the full circle", () => {
    const source: RandomSource = { seed: 5, rngState: 5 };
    for (let i = 0; i < 200; i++) {
      const angle = nextAngle(source);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
  });

  it("reaches every quadrant over a run of draws", () => {
    const source: RandomSource = { seed: 5, rngState: 5 };
    const quadrants = new Set<number>();
    for (let i = 0; i < 200; i++) {
      quadrants.add(Math.floor(nextAngle(source) / (Math.PI / 2)));
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("replays the same angles from the same seed", () => {
    const angles = (seed: number): number[] => {
      const source: RandomSource = { seed, rngState: seed };
      return Array.from({ length: 8 }, () => nextAngle(source));
    };
    expect(angles(77)).toEqual(angles(77));
    expect(angles(77)).not.toEqual(angles(78));
  });
});
