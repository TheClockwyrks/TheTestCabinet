import { describe, expect, it } from "vitest";
import { nextAngle, nextFloat, nextIndex, nextRange, nextSign } from "./rng";

describe("the random source", () => {
  it("draws inside [0, 1)", () => {
    for (let i = 0; i < 2000; i += 1) {
      const value = nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a float inside the range asked for", () => {
    for (let i = 0; i < 2000; i += 1) {
      const value = nextRange(60, 110);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThan(110);
    }
  });

  it("draws an index with every value reachable", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = nextIndex(4);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws an angle inside the full turn", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = nextAngle();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(Math.PI * 2);
    }
  });

  it("draws both signs", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(nextSign());
    expect([...seen].sort()).toEqual([-1, 1]);
  });
});
