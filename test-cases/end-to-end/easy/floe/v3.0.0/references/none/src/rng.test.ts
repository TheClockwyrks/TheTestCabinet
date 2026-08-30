// The seeded generator.
//
// The one property the specification asks of it is that its WHOLE state lives in
// the game's own state, so reseeding and replaying the same calls reproduces the
// same result exactly. Everything below is that property, plus enough of a
// distribution check to know the draws are not degenerate.

import { describe, expect, it } from "vitest";
import { pick, random, randomInt, type Random } from "./rng";

const source = (seed: number): Random => ({ rngState: seed });

/** `count` draws from a generator seeded at `seed`. */
function draws(seed: number, count: number): number[] {
  const state = source(seed);
  return Array.from({ length: count }, () => random(state));
}

describe("random", () => {
  it("draws the same sequence for the same seed, and a different one otherwise", () => {
    expect(draws(1, 20)).toEqual(draws(1, 20));
    expect(draws(1, 20)).not.toEqual(draws(2, 20));
  });

  it("keeps its whole state in the value it was handed", () => {
    const state = source(42);
    const first = random(state);
    const carried: Random = { rngState: state.rngState };
    const second = random(state);
    expect(random(carried)).toBe(second);
    expect(first).not.toBe(second);
  });

  it("draws inside the half-open unit interval", () => {
    for (const seed of [0, 1, 7, 1234, 2 ** 31]) {
      for (const value of draws(seed, 200)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it("spreads its draws across the interval", () => {
    const buckets = new Array<number>(10).fill(0);
    for (const value of draws(3, 2000)) buckets[Math.floor(value * 10)] += 1;
    for (const count of buckets) expect(count).toBeGreaterThan(100);
  });
});

describe("randomInt", () => {
  it("draws a whole number below the bound", () => {
    const state = source(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = randomInt(state, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it("draws zero for a bound of zero or less, without advancing", () => {
    const state = source(9);
    expect(randomInt(state, 0)).toBe(0);
    expect(randomInt(state, -3)).toBe(0);
    expect(state.rngState).toBe(9);
  });
});

describe("pick", () => {
  it("takes one of the items, and every one of them over enough draws", () => {
    const state = source(11);
    const items = ["a", "b", "c"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const chosen = pick(state, items);
      expect(chosen).not.toBe(null);
      seen.add(chosen as string);
    }
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });

  it("takes nothing from nothing", () => {
    expect(pick(source(1), [])).toBe(null);
  });
});
