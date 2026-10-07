import { describe, expect, it } from "vitest";

import { index, range, unit, word } from "./random";

const DRAWS = 2000;

describe("the game's random draws", () => {
  it("draws units inside [0, 1)", () => {
    for (let i = 0; i < DRAWS; i += 1) {
      const value = unit();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a range inside its bounds", () => {
    for (let i = 0; i < DRAWS; i += 1) {
      const value = range(1.4, 2.6);
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThan(2.6);
    }
  });

  it("draws whole indexes that reach every slot of a roster", () => {
    const seen = new Set<number>();
    for (let i = 0; i < DRAWS; i += 1) {
      const value = index(9);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(9);
      seen.add(value);
    }
    expect(seen.size).toBe(9);
    expect(index(0)).toBe(0);
    expect(index(-4)).toBe(0);
  });

  it("hands out whole 32-bit words for a burst to scatter from", () => {
    const words = Array.from({ length: 20 }, () => word());
    for (const value of words) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
    expect(new Set(words).size).toBeGreaterThan(1);
  });
});
