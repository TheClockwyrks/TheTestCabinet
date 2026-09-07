import { describe, expect, it } from "vitest";
import { nextFloat, nextInt, nextRange, nextSign, shuffle } from "./rng";

describe("the random source", () => {
  it("draws floats inside the unit interval", () => {
    for (let i = 0; i < 200; i++) {
      const value = nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not hand back one value over and over", () => {
    const draws = new Set(Array.from({ length: 32 }, () => nextFloat()));
    expect(draws.size).toBeGreaterThan(1);
  });

  it("draws whole numbers below the bound", () => {
    for (let i = 0; i < 200; i++) {
      const value = nextInt(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
  });

  it("draws inside a named range", () => {
    for (let i = 0; i < 200; i++) {
      const value = nextRange(180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
    }
  });

  it("draws both signs", () => {
    const signs = new Set<number>();
    for (let i = 0; i < 100; i++) signs.add(nextSign());
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("shuffles into a permutation of the input", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = shuffle(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it("shuffles differently from one call to the next", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    expect(shuffle(items)).not.toEqual(shuffle(items));
  });
});
