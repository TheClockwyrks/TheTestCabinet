import { describe, expect, it } from "vitest";
import {
  random,
  randomInt,
  randomPick,
  randomRange,
  seedRandom,
  type RandomSource,
} from "./rng";

function source(seed: number): RandomSource {
  return { rngState: seed };
}

describe("the seeded generator", () => {
  it("keeps its whole state in the field it was given", () => {
    const a = source(7);
    const before = a.rngState;
    random(a);
    expect(a.rngState).not.toBe(before);
  });

  it("reproduces a sequence from the same seed", () => {
    const a = source(0);
    const b = source(0);
    seedRandom(a, 12);
    seedRandom(b, 12);
    const left = Array.from({ length: 16 }, () => random(a));
    const right = Array.from({ length: 16 }, () => random(b));
    expect(left).toEqual(right);
  });

  it("gives a different sequence for a different seed", () => {
    const a = source(1);
    const b = source(2);
    expect(random(a)).not.toBe(random(b));
  });

  it("draws inside [0, 1)", () => {
    const a = source(99);
    for (let index = 0; index < 500; index += 1) {
      const draw = random(a);
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("draws a range inside its bounds", () => {
    const a = source(3);
    for (let index = 0; index < 200; index += 1) {
      const draw = randomRange(a, 1.4, 2.6);
      expect(draw).toBeGreaterThanOrEqual(1.4);
      expect(draw).toBeLessThan(2.6);
    }
  });

  it("draws a whole number including both ends", () => {
    const a = source(5);
    const seen = new Set<number>();
    for (let index = 0; index < 400; index += 1) {
      seen.add(randomInt(a, 0, 3));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("picks nothing from an empty list", () => {
    expect(randomPick(source(1), [])).toBeUndefined();
  });

  it("picks an entry of the list it was given", () => {
    const a = source(4);
    for (let index = 0; index < 50; index += 1) {
      expect(["x", "y", "z"]).toContain(randomPick(a, ["x", "y", "z"]));
    }
  });
});
