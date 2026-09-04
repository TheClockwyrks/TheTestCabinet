import { describe, expect, it } from "vitest";
import { CHARGE_IDS } from "./constants";
import { nextFloat, nextInt, pick, seedState } from "./rng";

describe("the seeded generator", () => {
  it("reaches the same sequence from the same seed", () => {
    const walk = (seed: number): number[] => {
      let state = seedState(seed);
      const out: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const drawn = nextFloat(state);
        state = drawn.state;
        out.push(drawn.value);
      }
      return out;
    };
    expect(walk(1)).toEqual(walk(1));
    expect(walk(1)).not.toEqual(walk(2));
  });

  it("keeps its whole state in one unsigned word", () => {
    let state = seedState(-1);
    expect(state).toBe(0xffffffff);
    for (let i = 0; i < 50; i += 1) {
      state = nextFloat(state).state;
      expect(Number.isInteger(state)).toBe(true);
      expect(state).toBeGreaterThanOrEqual(0);
      expect(state).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("draws floats inside the unit interval", () => {
    let state = seedState(7);
    for (let i = 0; i < 400; i += 1) {
      const drawn = nextFloat(state);
      state = drawn.state;
      expect(drawn.value).toBeGreaterThanOrEqual(0);
      expect(drawn.value).toBeLessThan(1);
    }
  });

  it("draws whole numbers inside the bound, and covers it", () => {
    let state = seedState(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const drawn = nextInt(state, 5);
      state = drawn.state;
      expect(drawn.value).toBeGreaterThanOrEqual(0);
      expect(drawn.value).toBeLessThan(5);
      seen.add(drawn.value);
    }
    expect(seen.size).toBe(5);
  });

  it("returns the only member of a bound of one, and advances nothing", () => {
    expect(nextInt(99, 1)).toEqual({ value: 0, state: 99 });
  });

  it("picks a member of the set it is given", () => {
    let state = seedState(11);
    for (let i = 0; i < 100; i += 1) {
      const drawn = pick(state, CHARGE_IDS);
      state = drawn.state;
      expect(CHARGE_IDS).toContain(drawn.value);
    }
  });

  it("refuses to draw from an empty set", () => {
    expect(() => pick(1, [])).toThrow(RangeError);
  });

  it("folds a non-finite seed to zero", () => {
    expect(seedState(Number.NaN)).toBe(0);
  });
});
