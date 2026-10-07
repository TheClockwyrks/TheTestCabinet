import { describe, expect, it } from "vitest";
import { random, randomInt, randomPick, randomRange } from "./random";

describe("the game's random draws", () => {
  it("draws inside [0, 1)", () => {
    for (let index = 0; index < 500; index += 1) {
      const draw = random();
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("draws a range inside its bounds", () => {
    for (let index = 0; index < 200; index += 1) {
      const draw = randomRange(1.4, 2.6);
      expect(draw).toBeGreaterThanOrEqual(1.4);
      expect(draw).toBeLessThan(2.6);
    }
  });

  it("draws a whole number including both ends", () => {
    const seen = new Set<number>();
    for (let index = 0; index < 400; index += 1) {
      seen.add(randomInt(0, 3));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("picks nothing from an empty list", () => {
    expect(randomPick([])).toBeUndefined();
  });

  it("picks an entry of the list it was given", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(["x", "y", "z"]).toContain(randomPick(["x", "y", "z"]));
    }
  });
});
