// The seeded generator is the whole of Carom's randomness, and
// `specs/instrumentation.md` requires that reseeding and replaying reproduce a
// scenario exactly — so what is checked here is reproducibility, not the
// statistics of the draw.

import { describe, expect, it } from "vitest";
import { nextRandom, nextSign, type RandomSource } from "./rng";

function draws(seed: number, count: number): number[] {
  const source: RandomSource = { rngState: seed };
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
    const source: RandomSource = { rngState: 7 };
    nextRandom(source);
    expect(source.rngState).not.toBe(7);
    expect(Number.isInteger(source.rngState)).toBe(true);
  });
});

describe("nextSign", () => {
  it("returns only +1 or -1", () => {
    const source: RandomSource = { rngState: 5 };
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(nextSign(source))).toBe(1);
    }
  });

  it("produces both signs over a run of draws", () => {
    const source: RandomSource = { rngState: 5 };
    const signs = new Set<number>();
    for (let i = 0; i < 50; i++) signs.add(nextSign(source));
    expect(signs).toEqual(new Set([-1, 1]));
  });
});
