// The game's random draws: inside their bounds, and the fixed sequence the
// starfield is laid out from.

import { describe, expect, it } from "vitest";
import {
  random,
  randomInt,
  randomRange,
  randomWord,
  scatter,
  shuffled,
} from "./random";

describe("the game's random draws", () => {
  it("draws inside the unit interval", () => {
    for (let i = 0; i < 200; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws inside the range it is given", () => {
    for (let i = 0; i < 200; i++) {
      const value = randomRange(1.4, 2.6);
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThan(2.6);
    }
  });

  it("draws whole numbers inside an inclusive range", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const value = randomInt(0, 3);
      expect(Number.isInteger(value)).toBe(true);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws a whole, non-negative word", () => {
    for (let i = 0; i < 50; i++) {
      const value = randomWord();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("shuffles a list into a permutation of itself", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const first = shuffled(items);
    expect([...first].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("scatters the same fixed sequence from the same word", () => {
    const run = (word: number): number[] => {
      const values: number[] = [];
      let state = word;
      for (let i = 0; i < 8; i++) {
        const [value, next] = scatter(state);
        state = next;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        values.push(value);
      }
      return values;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});
