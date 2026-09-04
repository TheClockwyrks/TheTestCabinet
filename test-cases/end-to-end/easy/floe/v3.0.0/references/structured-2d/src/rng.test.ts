// The seeded generator `specs/instrumentation.md` asks for: its whole state on
// the game's own state, so replaying the same calls reproduces the same result.

import { describe, expect, it } from "vitest";
import { pick, random, randomInt, type Random } from "./rng";

function source(seed: number): Random {
  return { rngState: seed };
}

describe("the generator", () => {
  it("draws in [0, 1) and advances its own state", () => {
    const held = source(1);
    const draws = Array.from({ length: 200 }, () => random(held));
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
    expect(new Set(draws).size).toBeGreaterThan(190);
    expect(held.rngState).not.toBe(1);
  });

  it("reproduces a sequence from the same seed", () => {
    const first = Array.from({ length: 32 }, () => random(source(7)));
    const second = Array.from({ length: 32 }, () => random(source(7)));
    expect(first).toEqual(second);
  });

  it("gives different seeds different sequences", () => {
    const a = source(7);
    const b = source(8);
    const left = Array.from({ length: 16 }, () => random(a));
    const right = Array.from({ length: 16 }, () => random(b));
    expect(left).not.toEqual(right);
  });

  it("draws a whole number inside the bound", () => {
    const held = source(3);
    for (let i = 0; i < 300; i += 1) {
      const drawn = randomInt(held, 5);
      expect(Number.isInteger(drawn)).toBe(true);
      expect(drawn).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeLessThan(5);
    }
    expect(randomInt(held, 0)).toBe(0);
    expect(randomInt(held, -2)).toBe(0);
  });

  it("picks from a list, and nothing from an empty one", () => {
    const held = source(11);
    const items = ["a", "b", "c"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const drawn = pick(held, items);
      expect(drawn).not.toBeNull();
      seen.add(drawn as string);
    }
    expect(seen).toEqual(new Set(items));
    expect(pick(held, [])).toBeNull();
  });
});
