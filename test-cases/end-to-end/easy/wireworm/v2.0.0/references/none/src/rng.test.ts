// Wireworm — the game's private random source.
//
// The draws are held to their bounds and to covering their range, which is all
// the game asks of them: which value comes next is the source's own business.

import { describe, expect, test } from "vitest";
import { randomChance, randomFloat, randomInt, randomRange } from "./rng";

const DRAWS = 2000;

describe("the random source", () => {
  test("a float lies in the unit interval", () => {
    for (let i = 0; i < DRAWS; i += 1) {
      const value = randomFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("a range draw lies inside its bounds", () => {
    for (let i = 0; i < DRAWS; i += 1) {
      const value = randomRange(7, 12);
      expect(value).toBeGreaterThanOrEqual(7);
      expect(value).toBeLessThan(12);
    }
  });

  test("an integer draw is whole, inside its bounds, and covers them", () => {
    const seen = new Set<number>();
    for (let i = 0; i < DRAWS; i += 1) {
      const value = randomInt(8, 15);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(8);
      expect(value).toBeLessThanOrEqual(15);
      seen.add(value);
    }
    expect(seen.size).toBe(8);
  });

  test("a chance draw lands on both sides", () => {
    const seen = new Set<boolean>();
    for (let i = 0; i < DRAWS; i += 1) seen.add(randomChance(0.5));
    expect(seen).toEqual(new Set([true, false]));
  });

  test("a certain chance always lands and an impossible one never does", () => {
    for (let i = 0; i < DRAWS; i += 1) {
      expect(randomChance(1)).toBe(true);
      expect(randomChance(0)).toBe(false);
    }
  });
});
