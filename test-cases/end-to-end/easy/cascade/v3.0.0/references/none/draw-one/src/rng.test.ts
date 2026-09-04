import { describe, expect, it } from "vitest";
import { nextFloat, shuffle, toSeed } from "./rng";

describe("the seeded generator", () => {
  it("keeps its whole state in the field it was handed", () => {
    const holder = { rngState: 12 };
    const first = nextFloat(holder);
    expect(holder.rngState).not.toBe(12);
    const replay = { rngState: 12 };
    expect(nextFloat(replay)).toBe(first);
  });

  it("draws floats inside the unit interval", () => {
    const holder = { rngState: 7 };
    for (let i = 0; i < 500; i += 1) {
      const value = nextFloat(holder);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("gives two seeds two sequences", () => {
    const a = { rngState: 1 };
    const b = { rngState: 2 };
    const drawsA = Array.from({ length: 8 }, () => nextFloat(a));
    const drawsB = Array.from({ length: 8 }, () => nextFloat(b));
    expect(drawsA).not.toEqual(drawsB);
  });

  it("normalizes a seed to a 32-bit unsigned number", () => {
    expect(toSeed(-1)).toBe(4294967295);
    expect(toSeed(Number.NaN)).toBe(0);
    expect(toSeed(5)).toBe(5);
  });
});

describe("the shuffle", () => {
  it("keeps every item and reproduces under one seed", () => {
    const source = Array.from({ length: 52 }, (_, i) => i);
    const once = shuffle([...source], { rngState: 99 });
    const twice = shuffle([...source], { rngState: 99 });
    expect(once).toEqual(twice);
    expect([...once].sort((a, b) => a - b)).toEqual(source);
  });

  it("moves the items at all", () => {
    const source = Array.from({ length: 52 }, (_, i) => i);
    expect(shuffle([...source], { rngState: 4 })).not.toEqual(source);
  });
});
