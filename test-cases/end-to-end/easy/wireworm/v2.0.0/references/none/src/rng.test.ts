// Wireworm — the seeded generator (specs/instrumentation.md).
//
// The whole point of it is reproducibility: the same seed and the same sequence
// of calls reach the same numbers, and the whole generator state lives in one
// field so that a reset can restore it.

import { describe, expect, test } from "vitest";
import { nextChance, nextFloat, nextInt, nextRange } from "./rng";

describe("the seeded generator", () => {
  test("the same seed replays the same stream", () => {
    const a = { rngState: 7 };
    const b = { rngState: 7 };
    const first = Array.from({ length: 20 }, () => nextFloat(a));
    const second = Array.from({ length: 20 }, () => nextFloat(b));
    expect(second).toEqual(first);
  });

  test("a different seed draws a different stream", () => {
    const a = { rngState: 7 };
    const b = { rngState: 8 };
    const first = Array.from({ length: 20 }, () => nextFloat(a));
    const second = Array.from({ length: 20 }, () => nextFloat(b));
    expect(second).not.toEqual(first);
  });

  test("the whole of the state is the one field", () => {
    const holder = { rngState: 3 };
    nextFloat(holder);
    const carried = holder.rngState;
    const next = nextFloat(holder);
    // Restoring the field alone restores the stream.
    const restored = { rngState: carried };
    expect(nextFloat(restored)).toBe(next);
  });

  test("every draw lands inside its range", () => {
    const holder = { rngState: 11 };
    for (let i = 0; i < 500; i += 1) {
      const float = nextFloat(holder);
      expect(float).toBeGreaterThanOrEqual(0);
      expect(float).toBeLessThan(1);
      const ranged = nextRange(holder, 7, 12);
      expect(ranged).toBeGreaterThanOrEqual(7);
      expect(ranged).toBeLessThan(12);
      const whole = nextInt(holder, 3, 6);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(3);
      expect(whole).toBeLessThanOrEqual(6);
    }
  });

  test("a chance of one is always taken and a chance of none never is", () => {
    const holder = { rngState: 5 };
    for (let i = 0; i < 100; i += 1) {
      expect(nextChance(holder, 1)).toBe(true);
      expect(nextChance(holder, 0)).toBe(false);
    }
  });

  test("an integer draw covers both ends of its range", () => {
    const holder = { rngState: 2 };
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) seen.add(nextInt(holder, 0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
