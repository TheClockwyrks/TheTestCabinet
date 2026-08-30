import { describe, expect, it } from "vitest";
import { random, randomInt, randomRange, randomSign, seedRandom } from "./rng";

describe("the seeded generator", () => {
  it("reproduces a sequence exactly from one seed", () => {
    const a = { rngState: 0 };
    const b = { rngState: 0 };
    seedRandom(a, 7);
    seedRandom(b, 7);
    const first = Array.from({ length: 16 }, () => random(a));
    const second = Array.from({ length: 16 }, () => random(b));
    expect(second).toEqual(first);
  });

  it("gives different seeds different sequences", () => {
    const a = { rngState: 0 };
    const b = { rngState: 0 };
    seedRandom(a, 7);
    seedRandom(b, 8);
    const first = Array.from({ length: 16 }, () => random(a));
    const second = Array.from({ length: 16 }, () => random(b));
    expect(second).not.toEqual(first);
  });

  it("keeps the whole generator in the state field", () => {
    const source = { rngState: 0 };
    seedRandom(source, 3);
    random(source);
    const carried = source.rngState;
    const expected = Array.from({ length: 8 }, () => random(source));
    const resumed = { rngState: carried };
    expect(Array.from({ length: 8 }, () => random(resumed))).toEqual(expected);
  });

  it("draws inside the range it is given", () => {
    const source = { rngState: 0 };
    seedRandom(source, 11);
    for (let draw = 0; draw < 500; draw += 1) {
      const value = random(source);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(randomRange(source, 7, 12)).toBeGreaterThanOrEqual(7);
      expect(randomRange(source, 7, 12)).toBeLessThan(12);
      const whole = randomInt(source, 8, 15);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(8);
      expect(whole).toBeLessThanOrEqual(15);
      expect(Math.abs(randomSign(source))).toBe(1);
    }
  });

  it("reaches both ends of a whole range", () => {
    const source = { rngState: 0 };
    seedRandom(source, 5);
    const seen = new Set<number>();
    for (let draw = 0; draw < 400; draw += 1) seen.add(randomInt(source, 0, 3));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
