import { describe, expect, it } from "vitest";
import { nextFloat, shuffle } from "./rng";

describe("the random source", () => {
  it("draws floats inside the unit interval", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not hand back one value over and over", () => {
    const draws = new Set(Array.from({ length: 32 }, () => nextFloat()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("the shuffle", () => {
  it("keeps every item", () => {
    const source = Array.from({ length: 52 }, (_, i) => i);
    const once = shuffle([...source]);
    expect([...once].sort((a, b) => a - b)).toEqual(source);
  });

  it("moves the items at all, and differently from one deal to the next", () => {
    const source = Array.from({ length: 52 }, (_, i) => i);
    const once = shuffle([...source]);
    const twice = shuffle([...source]);
    expect(once).not.toEqual(source);
    expect(once).not.toEqual(twice);
  });
});
