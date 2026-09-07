import { describe, expect, it } from "vitest";
import { unit } from "./random";

describe("the game's random draws", () => {
  it("draws inside the unit interval, and spreads over it", () => {
    const values: number[] = [];
    for (let i = 0; i < 500; i++) {
      const value = unit();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      values.push(value);
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(new Set(values).size).toBeGreaterThan(450);
  });
});
