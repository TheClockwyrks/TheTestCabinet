import { describe, expect, it } from "vitest";
import { nextRandom, nextRange, nextSign, shuffle } from "./rng";

describe("the random source", () => {
  it("draws inside the unit interval", () => {
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom();
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("does not hand back one value over and over", () => {
    const draws = new Set(Array.from({ length: 32 }, () => nextRandom()));
    expect(draws.size).toBeGreaterThan(1);
  });

  it("draws a range inside its bounds, and both signs", () => {
    const signs = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      const value = nextRange(180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
      signs.add(nextSign());
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("shuffles every entry exactly once, and afresh each time", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const first = shuffle([...items]);
    const second = shuffle([...items]);
    expect([...first].sort((x, y) => x - y)).toEqual(items);
    expect(second).not.toEqual(first);
    expect(first).not.toEqual(items);
  });
});
