// The game's random source: every draw lands inside the range it is asked for,
// and every option is reached.

import { describe, expect, it } from "vitest";
import { pick, random, randomInt } from "./rng";

describe("random", () => {
  it("draws inside [0, 1)", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("spreads its draws across the interval", () => {
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 2000; i += 1) buckets[Math.floor(random() * 10)] += 1;
    for (const count of buckets) expect(count).toBeGreaterThan(100);
  });
});

describe("randomInt", () => {
  it("draws a whole number below the bound, and every one of them over enough draws", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) {
      const value = randomInt(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
  });

  it("draws zero for a bound of zero or less", () => {
    expect(randomInt(0)).toBe(0);
    expect(randomInt(-3)).toBe(0);
  });
});

describe("pick", () => {
  it("takes one of the items, and every one of them over enough draws", () => {
    const items = ["a", "b", "c"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const chosen = pick(items);
      expect(chosen).not.toBe(null);
      seen.add(chosen as string);
    }
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });

  it("takes nothing from nothing", () => {
    expect(pick([])).toBe(null);
  });
});
