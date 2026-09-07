import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

/** A source that hands out `values` in order, then starts over. */
function cycling(values: readonly number[]): () => number {
  let at = 0;
  return () => {
    const value = values[at % values.length];
    at += 1;
    return value;
  };
}

describe("the random source", () => {
  it("draws on [0, 1) from Math.random by default", () => {
    const rng = new Rng();
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("draws from the source it is given", () => {
    const rng = new Rng(cycling([0.25, 0.75]));
    expect(rng.next()).toBe(0.25);
    expect(rng.next()).toBe(0.75);
    expect(rng.next()).toBe(0.25);
  });

  it("samples distinct items without replacement, all of them when short", () => {
    const rng = new Rng();
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
    const rng = new Rng();
    for (let i = 0; i < 200; i += 1) {
      const index = rng.index(4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
    expect(["p", "q"]).toContain(rng.pick(["p", "q"]));
  });

  it("picks by the source's draw", () => {
    expect(new Rng(() => 0).pick(["p", "q"])).toBe("p");
    expect(new Rng(() => 0.999).pick(["p", "q"])).toBe("q");
  });
});
