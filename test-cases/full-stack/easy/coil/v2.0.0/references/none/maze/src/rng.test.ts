import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("reproduces the same sequence from the same seed", () => {
    const first = new Rng(7);
    const second = new Rng(7);
    const a = Array.from({ length: 32 }, () => first.next());
    const b = Array.from({ length: 32 }, () => second.next());
    expect(a).toEqual(b);
  });

  it("draws a different sequence from a different seed", () => {
    const a = Array.from({ length: 8 }, (_, i) => new Rng(1 + i).next());
    expect(new Set(a).size).toBe(a.length);
  });

  it("draws in [0, 1)", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 512; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a whole number below the count it is given", () => {
    const rng = new Rng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 512; i++) {
      const value = rng.below(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });
});
