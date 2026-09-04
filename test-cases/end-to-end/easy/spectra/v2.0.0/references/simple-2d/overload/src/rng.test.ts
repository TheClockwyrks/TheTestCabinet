// The seeded generator: reproducible from the state it is handed, and nothing else.

import { describe, expect, it } from "vitest";
import { nextInt, nextRandom, nextRange, nextSeed, shuffled } from "./rng";

describe("the seeded generator", () => {
  it("draws the same sequence from the same seed", () => {
    const run = (seed: number): number[] => {
      const values: number[] = [];
      let state = seed;
      for (let i = 0; i < 8; i++) {
        const [value, next] = nextRandom(state);
        state = next;
        values.push(value);
      }
      return values;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("draws inside the range it is given", () => {
    let state = 1;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextRange(state, 1.4, 2.6);
      state = next;
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThan(2.6);
    }
  });

  it("draws whole numbers inside an inclusive range", () => {
    const seen = new Set<number>();
    let state = 3;
    for (let i = 0; i < 400; i++) {
      const [value, next] = nextInt(state, 0, 3);
      state = next;
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws a whole, non-negative seed", () => {
    let state = 11;
    for (let i = 0; i < 50; i++) {
      const [value, next] = nextSeed(state);
      state = next;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("shuffles a list into a permutation of itself", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const [first] = shuffled(21, items);
    const [again] = shuffled(21, items);
    const [other] = shuffled(22, items);
    expect([...first].sort((a, b) => a - b)).toEqual(items);
    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
  });
});
