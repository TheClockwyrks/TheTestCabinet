import { describe, expect, it } from "vitest";
import { Rng, seedState } from "./rng";

describe("the seeded generator", () => {
  it("reduces any seed to a 32-bit state", () => {
    expect(seedState(1)).toBe(1);
    expect(seedState(-1)).toBe(0xffffffff);
    expect(seedState(2 ** 40 + 5)).toBe(5);
    expect(seedState(NaN)).toBe(0);
  });

  it("replays the same sequence from the same state", () => {
    const cellA = { rngState: 7 };
    const cellB = { rngState: 7 };
    const rngA = new Rng(() => cellA);
    const rngB = new Rng(() => cellB);
    const first = Array.from({ length: 20 }, () => rngA.next());
    const second = Array.from({ length: 20 }, () => rngB.next());
    expect(first).toEqual(second);
    expect(cellA.rngState).toBe(cellB.rngState);
  });

  it("draws on [0, 1) and keeps a whole 32-bit state in the cell", () => {
    const cell = { rngState: 1 };
    const rng = new Rng(() => cell);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(Number.isInteger(cell.rngState)).toBe(true);
      expect(cell.rngState).toBeGreaterThanOrEqual(0);
      expect(cell.rngState).toBeLessThan(2 ** 32);
    }
  });

  it("samples distinct items without replacement, all of them when short", () => {
    const rng = new Rng(() => ({ rngState: 3 }));
    const items = ["a", "b", "c", "d", "e"];
    const drawn = rng.sample(items, 3);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn).size).toBe(3);
    for (const item of drawn) expect(items).toContain(item);
    const short = rng.sample(["x", "y"], 3);
    expect(short).toHaveLength(2);
    expect(short).toEqual(expect.arrayContaining(["x", "y"]));
    expect(rng.sample([], 3)).toEqual([]);
  });

  it("picks an index inside the range", () => {
    const rng = new Rng(() => ({ rngState: 11 }));
    for (let i = 0; i < 200; i += 1) {
      const index = rng.index(4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
    expect(["p", "q"]).toContain(rng.pick(["p", "q"]));
  });
});
