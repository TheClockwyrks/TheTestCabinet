import { describe, expect, it } from "vitest";
import { drawBelow, nextRandom, seedState } from "./rng";

describe("the seeded generator", () => {
  it("reproduces the same sequence from the same seed", () => {
    const take = (seed: number): number[] => {
      let state = seedState(seed);
      const values: number[] = [];
      for (let i = 0; i < 12; i++) {
        const draw = nextRandom(state);
        values.push(draw.value);
        state = draw.state;
      }
      return values;
    };
    expect(take(7)).toEqual(take(7));
  });

  it("draws a different sequence from a different seed", () => {
    expect(nextRandom(seedState(1)).value).not.toBe(
      nextRandom(seedState(2)).value,
    );
  });

  it("draws in [0, 1)", () => {
    let state = seedState(99);
    for (let i = 0; i < 2000; i++) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.state;
    }
  });

  it("draws a whole number below the count it is given", () => {
    let state = seedState(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const draw = drawBelow(state, 4);
      expect(Number.isInteger(draw.index)).toBe(true);
      expect(draw.index).toBeGreaterThanOrEqual(0);
      expect(draw.index).toBeLessThan(4);
      seen.add(draw.index);
      state = draw.state;
    }
    expect(seen.size).toBe(4);
  });

  it("returns the generator state beside every draw, so nothing is held", () => {
    const first = nextRandom(seedState(3));
    const second = nextRandom(first.state);
    expect(second.value).not.toBe(first.value);
    // Replaying from the same state reproduces the same draw exactly.
    expect(nextRandom(first.state).value).toBe(second.value);
  });
});
