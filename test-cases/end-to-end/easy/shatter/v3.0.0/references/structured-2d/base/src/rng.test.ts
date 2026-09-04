import { describe, expect, it } from "vitest";
import {
  random,
  randomInt,
  randomRange,
  randomSign,
  seedRandom,
  type RandomSource,
} from "./rng";

function source(seed: number): RandomSource {
  const holder: RandomSource = { rngState: 0 };
  seedRandom(holder, seed);
  return holder;
}

describe("the seeded generator", () => {
  it("keeps its whole state in the one field", () => {
    const a = source(7);
    const b = source(7);
    const first = [random(a), random(a), random(a)];
    // Replaying from a copy of the field alone reproduces the sequence.
    const copy: RandomSource = { rngState: b.rngState };
    expect([random(copy), random(copy), random(copy)]).toEqual(first);
  });

  it("reseeding replays the same draws", () => {
    const holder = source(3);
    const first = [random(holder), random(holder)];
    seedRandom(holder, 3);
    expect([random(holder), random(holder)]).toEqual(first);
  });

  it("different seeds give different sequences", () => {
    const a = source(7);
    const b = source(8);
    expect(random(a)).not.toBeCloseTo(random(b), 6);
  });

  it("draws inside its range", () => {
    const holder = source(11);
    for (let index = 0; index < 500; index += 1) {
      const value = random(holder);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(randomRange(holder, 60, 110)).toBeGreaterThanOrEqual(60);
      expect(randomRange(holder, 60, 110)).toBeLessThan(110);
      const whole = randomInt(holder, 0, 3);
      expect(whole).toBeGreaterThanOrEqual(0);
      expect(whole).toBeLessThanOrEqual(3);
      expect(Math.abs(randomSign(holder))).toBe(1);
    }
  });

  it("spreads its draws over the unit interval from a small seed", () => {
    const holder = source(1);
    const buckets = [0, 0, 0, 0];
    for (let index = 0; index < 4000; index += 1) {
      buckets[Math.min(3, Math.floor(random(holder) * 4))] += 1;
    }
    for (const count of buckets) expect(count).toBeGreaterThan(800);
  });
});
