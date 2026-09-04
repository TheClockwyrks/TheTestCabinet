import { describe, expect, it } from "vitest";
import { nextFloat, nextInt, nextRange, nextSign, shuffle } from "./rng";

describe("the seeded generator", () => {
  it("reproduces the same sequence from the same seed", () => {
    const run = (seed: number): number[] => {
      let state = seed;
      const out: number[] = [];
      for (let i = 0; i < 8; i++) {
        const [value, next] = nextFloat(state);
        out.push(value);
        state = next;
      }
      return out;
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it("draws floats inside the unit interval", () => {
    let state = 7;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextFloat(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it("draws whole numbers below the bound", () => {
    let state = 3;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextInt(state, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      state = next;
    }
  });

  it("draws inside a named range", () => {
    let state = 11;
    for (let i = 0; i < 200; i++) {
      const [value, next] = nextRange(state, 180, 420);
      expect(value).toBeGreaterThanOrEqual(180);
      expect(value).toBeLessThan(420);
      state = next;
    }
  });

  it("draws both signs", () => {
    const signs = new Set<number>();
    let state = 1;
    for (let i = 0; i < 100; i++) {
      const [value, next] = nextSign(state);
      signs.add(value);
      state = next;
    }
    expect([...signs].sort()).toEqual([-1, 1]);
  });

  it("shuffles into a permutation of the input", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const [shuffled] = shuffle(items, 1);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it("shuffles the same way from the same seed", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(items, 5)[0]).toEqual(shuffle(items, 5)[0]);
    expect(shuffle(items, 5)[0]).not.toEqual(shuffle(items, 6)[0]);
  });
});
