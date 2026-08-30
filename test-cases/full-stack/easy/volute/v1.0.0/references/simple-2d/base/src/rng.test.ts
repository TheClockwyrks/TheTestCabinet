// The one seeded generator, on its own: the whole of its state is the word it
// carries, so the same word draws the same value every time.

import { describe, expect, it } from "vitest";
import { CHARGE_IDS } from "./constants";
import { nextFloat, nextInt, pick, seedState } from "./rng";

describe("seedState", () => {
  it("folds any number into an unsigned 32-bit word", () => {
    expect(seedState(0)).toBe(0);
    expect(seedState(7)).toBe(7);
    expect(seedState(-1)).toBe(0xffffffff);
    expect(seedState(2 ** 32 + 5)).toBe(5);
    expect(seedState(Number.NaN)).toBe(0);
    expect(seedState(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("nextFloat", () => {
  it("draws in [0, 1) and carries its whole state in the word", () => {
    let state = seedState(1);
    const drawn: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const next = nextFloat(state);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(1);
      drawn.push(next.value);
      state = next.state;
    }
    // The same word replays the same sequence.
    let replay = seedState(1);
    for (const value of drawn) {
      const next = nextFloat(replay);
      expect(next.value).toBe(value);
      replay = next.state;
    }
  });

  it("spreads its draws across the unit interval", () => {
    const buckets = new Array<number>(5).fill(0);
    let state = seedState(42);
    for (let i = 0; i < 5000; i += 1) {
      const next = nextFloat(state);
      buckets[Math.min(4, Math.floor(next.value * 5))] += 1;
      state = next.state;
    }
    for (const count of buckets) expect(count).toBeGreaterThan(800);
  });
});

describe("nextInt", () => {
  it("stays inside its bound", () => {
    let state = seedState(3);
    for (let i = 0; i < 1000; i += 1) {
      const next = nextInt(state, 5);
      expect(next.value).toBeGreaterThanOrEqual(0);
      expect(next.value).toBeLessThan(5);
      state = next.state;
    }
  });

  it("draws zero, and advances nothing, for a bound of one or less", () => {
    const state = seedState(9);
    expect(nextInt(state, 1)).toEqual({ value: 0, state });
    expect(nextInt(state, 0)).toEqual({ value: 0, state });
  });
});

describe("pick", () => {
  it("reaches every member of the set", () => {
    const seen = new Set<string>();
    let state = seedState(11);
    for (let i = 0; i < 500; i += 1) {
      const next = pick(state, CHARGE_IDS);
      seen.add(next.value);
      state = next.state;
    }
    expect(seen.size).toBe(CHARGE_IDS.length);
  });

  it("refuses an empty set rather than inventing a value", () => {
    expect(() => pick(seedState(1), [])).toThrow(RangeError);
  });
});
