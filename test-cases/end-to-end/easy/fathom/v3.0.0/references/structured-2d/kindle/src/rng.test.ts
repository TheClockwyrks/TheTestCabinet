import { describe, expect, it } from "vitest";

import { DEFAULT_SEED } from "./constants";
import { Rng } from "./rng";

describe("the seeded generator", () => {
  it("draws inside [0, 1)", () => {
    const rng = new Rng(DEFAULT_SEED);
    for (let draw = 0; draw < 5000; draw++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("replays the same sequence from the same seed", () => {
    const first = new Rng(7);
    const second = new Rng(7);
    const drawn = Array.from({ length: 64 }, () => first.next());
    expect(drawn).toEqual(Array.from({ length: 64 }, () => second.next()));
  });

  it("puts a run back where it started when it is reseeded", () => {
    const rng = new Rng(DEFAULT_SEED);
    const opening = Array.from({ length: 32 }, () => rng.next());
    rng.reseed(DEFAULT_SEED);
    expect(Array.from({ length: 32 }, () => rng.next())).toEqual(opening);
  });

  it("separates seeds", () => {
    const one = new Rng(1);
    const two = new Rng(2);
    const drawn = Array.from({ length: 16 }, () => one.next());
    expect(drawn).not.toEqual(Array.from({ length: 16 }, () => two.next()));
  });

  it("picks inside the list it is given", () => {
    const rng = new Rng(DEFAULT_SEED);
    const items = ["up", "down", "left", "right"] as const;
    const seen = new Set<string>();
    for (let draw = 0; draw < 200; draw++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual([...items].sort());
  });
});
