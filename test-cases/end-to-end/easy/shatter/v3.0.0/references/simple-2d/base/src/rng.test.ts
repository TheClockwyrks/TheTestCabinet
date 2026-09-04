// The seeded generator: a draw beside the state that follows it.

import { describe, expect, it } from "vitest";
import { nextInt, nextRandom, nextRange, nextSign } from "./rng";

describe("the generator", () => {
  it("reproduces a sequence exactly from the same seed", () => {
    const run = (seed: number): number[] => {
      let state = seed;
      const drawn: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const [value, next] = nextRandom(state);
        drawn.push(value);
        state = next;
      }
      return drawn;
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it("draws inside its range", () => {
    let state = 7;
    for (let i = 0; i < 500; i += 1) {
      const [value, next] = nextRange(state, -3, 11);
      expect(value).toBeGreaterThanOrEqual(-3);
      expect(value).toBeLessThan(11);
      state = next;
    }
  });

  it("draws whole numbers inside an inclusive range", () => {
    let state = 3;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      const [value, next] = nextInt(state, 0, 3);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(3);
      seen.add(value);
      state = next;
    }
    expect(seen.size).toBe(4);
  });

  it("flips a sign both ways", () => {
    let state = 11;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      const [value, next] = nextSign(state);
      seen.add(value);
      state = next;
    }
    expect(seen).toEqual(new Set([1, -1]));
  });
});
