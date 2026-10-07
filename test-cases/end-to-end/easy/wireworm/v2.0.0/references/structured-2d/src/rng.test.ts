import { describe, expect, it } from "vitest";
import { random, randomInt, randomRange, randomSign } from "./rng";

const DRAWS = 2000;

describe("the random source", () => {
  it("keeps every draw inside its bounds", () => {
    for (let draw = 0; draw < DRAWS; draw += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(randomRange(7, 12)).toBeGreaterThanOrEqual(7);
      expect(randomRange(7, 12)).toBeLessThan(12);
      const whole = randomInt(8, 15);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(8);
      expect(whole).toBeLessThanOrEqual(15);
      expect(Math.abs(randomSign())).toBe(1);
    }
  });

  it("covers every value of a small whole range and both signs", () => {
    const seen = new Set<number>();
    const signs = new Set<number>();
    for (let draw = 0; draw < DRAWS; draw += 1) {
      seen.add(randomInt(0, 3));
      signs.add(randomSign());
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
    expect(signs).toEqual(new Set([-1, 1]));
  });
});
