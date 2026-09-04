// The seeded generator: a draw is a function of the state it is given, and the
// state it returns is the whole of what the next draw needs.

import { describe, expect, it } from "vitest";
import { nextInt, nextRandom, nextRange, nextSign } from "./rng";

describe("the generator", () => {
  it("replays exactly from the same state", () => {
    const run = (seed: number, count: number): number[] => {
      let state = seed;
      const drawn: number[] = [];
      for (let i = 0; i < count; i++) {
        const [value, next] = nextRandom(state);
        state = next;
        drawn.push(value);
      }
      return drawn;
    };
    expect(run(7, 20)).toEqual(run(7, 20));
    expect(run(7, 20)).not.toEqual(run(8, 20));
  });

  it("draws inside the unit interval", () => {
    let state = 1;
    for (let i = 0; i < 500; i++) {
      const [value, next] = nextRandom(state);
      state = next;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws a range and a whole range inside their bounds", () => {
    let state = 42;
    for (let i = 0; i < 300; i++) {
      const [value, afterValue] = nextRange(state, 7, 12);
      const [whole, afterWhole] = nextInt(afterValue, 3, 5);
      const [sign, afterSign] = nextSign(afterWhole);
      state = afterSign;
      expect(value).toBeGreaterThanOrEqual(7);
      expect(value).toBeLessThan(12);
      expect(whole).toBeGreaterThanOrEqual(3);
      expect(whole).toBeLessThanOrEqual(5);
      expect(Number.isInteger(whole)).toBe(true);
      expect(Math.abs(sign)).toBe(1);
    }
  });

  it("covers both signs and every whole value of a small range", () => {
    let state = 3;
    const signs = new Set<number>();
    const wholes = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const [sign, afterSign] = nextSign(state);
      const [whole, afterWhole] = nextInt(afterSign, 0, 3);
      state = afterWhole;
      signs.add(sign);
      wholes.add(whole);
    }
    expect(signs).toEqual(new Set([-1, 1]));
    expect(wholes).toEqual(new Set([0, 1, 2, 3]));
  });
});
