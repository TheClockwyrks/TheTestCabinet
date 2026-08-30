// The game's one generator: the same seed replays exactly, and nothing else
// carries state between draws.

import { describe, expect, it } from "vitest";
import { nextState, seedState, unit } from "./rng";

describe("the seeded generator", () => {
  it("replays a sequence exactly from one seed", () => {
    const draw = (seed: number, count: number): number[] => {
      let state = seedState(seed);
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        state = nextState(state);
        out.push(unit(state));
      }
      return out;
    };
    expect(draw(1, 8)).toEqual(draw(1, 8));
    expect(draw(1, 8)).not.toEqual(draw(2, 8));
  });

  it("lands every seed on a usable state, zero included", () => {
    for (const seed of [0, 1, -7, 2 ** 31, 0.5]) {
      expect(seedState(seed)).not.toBe(0);
      expect(Number.isInteger(seedState(seed))).toBe(true);
    }
  });

  it("draws inside the unit interval, and spreads over it", () => {
    let state = seedState(9);
    const values: number[] = [];
    for (let i = 0; i < 500; i++) {
      state = nextState(state);
      const value = unit(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      values.push(value);
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(new Set(values).size).toBeGreaterThan(450);
  });
});
