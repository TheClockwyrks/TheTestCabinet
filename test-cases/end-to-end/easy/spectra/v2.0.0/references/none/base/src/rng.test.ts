import { describe, expect, it } from "vitest";

import { Rng, nextUnit, seedRng } from "./rng";

describe("the seeded generator", () => {
  it("keeps its whole state in one word, so a replay is exact", () => {
    const first: number[] = [];
    let state = seedRng(1234);
    for (let i = 0; i < 8; i += 1) {
      const step = nextUnit(state);
      first.push(step.value);
      state = step.state;
    }
    const again: number[] = [];
    state = seedRng(1234);
    for (let i = 0; i < 8; i += 1) {
      const step = nextUnit(state);
      again.push(step.value);
      state = step.state;
    }
    expect(again).toEqual(first);
  });

  it("gives a different sequence for a different seed", () => {
    expect(nextUnit(seedRng(1)).value).not.toBe(nextUnit(seedRng(2)).value);
  });

  it("draws in [0, 1)", () => {
    const rng = new Rng(seedRng(7));
    for (let i = 0; i < 500; i += 1) {
      const value = rng.unit();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("carries the state forward on a cursor, so no draw is lost", () => {
    const rng = new Rng(seedRng(99));
    const a = rng.unit();
    const carried = rng.state;
    const b = rng.unit();
    expect(a).not.toBe(b);
    expect(nextUnit(carried).value).toBe(b);
  });

  it("ranges between the bounds it is given", () => {
    const rng = new Rng(seedRng(3));
    for (let i = 0; i < 200; i += 1) {
      const value = rng.range(1.4, 2.6);
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThan(2.6);
    }
  });

  it("indexes inside a roster, and answers 0 for an empty one", () => {
    const rng = new Rng(seedRng(5));
    for (let i = 0; i < 200; i += 1) {
      const index = rng.index(9);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(9);
    }
    expect(rng.index(0)).toBe(0);
    expect(rng.index(-4)).toBe(0);
  });

  it("hands out whole 32-bit words for a burst to be seeded from", () => {
    const rng = new Rng(seedRng(11));
    const words = Array.from({ length: 20 }, () => rng.word());
    for (const word of words) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThan(0x100000000);
    }
    expect(new Set(words).size).toBeGreaterThan(15);
  });
});
