import { describe, expect, it } from "vitest";
import { drawBelow } from "./rng";

describe("drawBelow", () => {
  it("draws a whole number below the count it is given", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 512; i++) {
      const value = drawBelow(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it("answers 0 for a count of 1", () => {
    for (let i = 0; i < 16; i++) expect(drawBelow(1)).toBe(0);
  });
});
