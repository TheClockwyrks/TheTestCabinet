// The random source: every draw is held to its bounds and to covering its
// range, which is all the game asks of it.

import { describe, expect, it } from "vitest";
import { random, randomInt, randomRange, randomSign } from "./rng";

const DRAWS = 2000;

describe("the random source", () => {
  it("draws inside the unit interval", () => {
    for (let i = 0; i < DRAWS; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a range and a whole range inside their bounds", () => {
    for (let i = 0; i < DRAWS; i++) {
      const value = randomRange(7, 12);
      const whole = randomInt(3, 5);
      expect(value).toBeGreaterThanOrEqual(7);
      expect(value).toBeLessThan(12);
      expect(whole).toBeGreaterThanOrEqual(3);
      expect(whole).toBeLessThanOrEqual(5);
      expect(Number.isInteger(whole)).toBe(true);
      expect(Math.abs(randomSign())).toBe(1);
    }
  });

  it("covers both signs and every whole value of a small range", () => {
    const signs = new Set<number>();
    const wholes = new Set<number>();
    for (let i = 0; i < DRAWS; i++) {
      signs.add(randomSign());
      wholes.add(randomInt(0, 3));
    }
    expect(signs).toEqual(new Set([-1, 1]));
    expect(wholes).toEqual(new Set([0, 1, 2, 3]));
  });
});
