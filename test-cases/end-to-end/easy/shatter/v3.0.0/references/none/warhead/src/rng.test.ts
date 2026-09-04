import { describe, expect, it } from "vitest";

import { random, range, rangeInt, seed, sign, type RandomSource } from "./rng";

/** A bare holder of the generator's whole state, as the game's state is. */
function source(value: number): RandomSource {
  const holder: RandomSource = { rng: 0 };
  seed(holder, value);
  return holder;
}

describe("the seeded generator", () => {
  it("reproduces a stream exactly from the same seed", () => {
    const a = source(7);
    const b = source(7);
    const first = Array.from({ length: 32 }, () => random(a));
    const second = Array.from({ length: 32 }, () => random(b));
    expect(second).toEqual(first);
  });

  it("produces a different stream from a different seed", () => {
    const a = source(7);
    const b = source(8);
    const first = Array.from({ length: 32 }, () => random(a));
    const second = Array.from({ length: 32 }, () => random(b));
    expect(second).not.toEqual(first);
  });

  it("keeps its whole state in the holder, so reseeding rewinds it", () => {
    const holder = source(3);
    const first = [random(holder), random(holder), random(holder)];
    seed(holder, 3);
    expect([random(holder), random(holder), random(holder)]).toEqual(first);
  });

  it("stays inside [0, 1)", () => {
    const holder = source(11);
    for (let i = 0; i < 5000; i += 1) {
      const value = random(holder);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("nudges a zero seed off the degenerate word", () => {
    const holder = source(0);
    expect(holder.rng).toBe(1);
  });

  it("draws a float inside the range asked for", () => {
    const holder = source(5);
    for (let i = 0; i < 2000; i += 1) {
      const value = range(holder, 60, 110);
      expect(value).toBeGreaterThanOrEqual(60);
      expect(value).toBeLessThan(110);
    }
  });

  it("draws a whole number with both ends reachable", () => {
    const holder = source(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) seen.add(rangeInt(holder, 0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("draws both signs", () => {
    const holder = source(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) seen.add(sign(holder));
    expect([...seen].sort()).toEqual([-1, 1]);
  });
});
