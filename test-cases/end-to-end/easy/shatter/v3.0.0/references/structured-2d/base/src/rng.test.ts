import { describe, expect, it } from "vitest";

import { random, randomInt, randomRange, randomSign } from "./rng";

describe("the random source", () => {
  it("draws inside [0, 1)", () => {
    for (let i = 0; i < 2000; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a float inside the range asked for", () => {
    for (let i = 0; i < 2000; i += 1) {
      const value = randomRange(60, 110);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThan(110);
    }
  });

  it("draws a whole number with both ends reachable", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = randomInt(0, 3);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws both signs", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(randomSign());
    expect([...seen].sort()).toEqual([-1, 1]);
  });
});
