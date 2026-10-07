// The random source: every draw stays inside its range and is drawn afresh.

import { describe, expect, it } from "vitest";
import { nextBetween, nextRandom, nextSign, shuffle } from "./rng";

describe("nextRandom", () => {
  it("stays in [0, 1)", () => {
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom();
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("does not hand back one value over and over", () => {
    const draws = new Set(Array.from({ length: 40 }, () => nextRandom()));
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe("nextBetween", () => {
  it("stays inside its range", () => {
    for (let i = 0; i < 400; i += 1) {
      const draw = nextBetween(180, 420);
      expect(draw).toBeGreaterThanOrEqual(180);
      expect(draw).toBeLessThan(420);
    }
  });
});

describe("nextSign", () => {
  it("gives both signs, roughly evenly", () => {
    let positive = 0;
    for (let i = 0; i < 1000; i += 1) if (nextSign() === 1) positive += 1;
    expect(positive).toBeGreaterThan(400);
    expect(positive).toBeLessThan(600);
  });
});

describe("shuffle", () => {
  it("keeps every element exactly once", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    shuffle(items);
    expect([...items].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 52 }, (_, i) => i),
    );
  });

  it("reaches a different order from one shuffle to the next", () => {
    const a = Array.from({ length: 52 }, (_, i) => i);
    const b = Array.from({ length: 52 }, (_, i) => i);
    shuffle(a);
    shuffle(b);
    expect(a).not.toEqual(b);
  });
});
