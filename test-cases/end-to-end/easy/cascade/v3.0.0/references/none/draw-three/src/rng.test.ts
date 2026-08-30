// The seeded generator: the whole of it is one number on the state.

import { describe, expect, it } from "vitest";
import { nextBetween, nextRandom, nextSign, shuffle } from "./rng";

describe("nextRandom", () => {
  it("stays in [0, 1)", () => {
    const source = { rngState: 12345 };
    for (let i = 0; i < 500; i += 1) {
      const draw = nextRandom(source);
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });

  it("replays exactly from the same seed", () => {
    const first = { rngState: 7 };
    const second = { rngState: 7 };
    const a = Array.from({ length: 40 }, () => nextRandom(first));
    const b = Array.from({ length: 40 }, () => nextRandom(second));
    expect(a).toEqual(b);
  });

  it("diverges from a different seed", () => {
    const a = { rngState: 1 };
    const b = { rngState: 2 };
    expect(nextRandom(a)).not.toBe(nextRandom(b));
  });

  it("keeps its whole state in the field it was given", () => {
    const source = { rngState: 99 };
    nextRandom(source);
    const carried = source.rngState;
    const forked = { rngState: carried };
    expect(nextRandom(forked)).toBe(nextRandom(source));
  });
});

describe("nextBetween", () => {
  it("stays inside its range", () => {
    const source = { rngState: 3 };
    for (let i = 0; i < 400; i += 1) {
      const draw = nextBetween(source, 180, 420);
      expect(draw).toBeGreaterThanOrEqual(180);
      expect(draw).toBeLessThan(420);
    }
  });
});

describe("nextSign", () => {
  it("gives both signs, roughly evenly", () => {
    const source = { rngState: 5 };
    let positive = 0;
    for (let i = 0; i < 1000; i += 1) if (nextSign(source) === 1) positive += 1;
    expect(positive).toBeGreaterThan(400);
    expect(positive).toBeLessThan(600);
  });
});

describe("shuffle", () => {
  it("keeps every element exactly once", () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    shuffle(items, { rngState: 11 });
    expect([...items].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 52 }, (_, i) => i),
    );
  });

  it("reaches the same order from the same seed", () => {
    const a = Array.from({ length: 52 }, (_, i) => i);
    const b = Array.from({ length: 52 }, (_, i) => i);
    shuffle(a, { rngState: 4 });
    shuffle(b, { rngState: 4 });
    expect(a).toEqual(b);
  });

  it("reaches a different order from a different seed", () => {
    const a = Array.from({ length: 52 }, (_, i) => i);
    const b = Array.from({ length: 52 }, (_, i) => i);
    shuffle(a, { rngState: 4 });
    shuffle(b, { rngState: 5 });
    expect(a).not.toEqual(b);
  });
});
