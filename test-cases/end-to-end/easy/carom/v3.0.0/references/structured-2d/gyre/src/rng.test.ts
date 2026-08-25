// The seeded generator is the whole of Carom's randomness, and
// `specs/instrumentation.md` requires that reseeding and replaying reproduce a
// scenario exactly — so what is checked here is reproducibility, not the
// statistics of the draw.

import { describe, expect, it } from "vitest";
import { nextRandom, nextSign } from "./rng";

function draws(seed: number, count: number): number[] {
  const values: number[] = [];
  let state = seed;
  for (let i = 0; i < count; i++) {
    const [value, next] = nextRandom(state);
    values.push(value);
    state = next;
  }
  return values;
}

describe("nextRandom", () => {
  it("replays the same sequence from the same seed", () => {
    expect(draws(1, 8)).toEqual(draws(1, 8));
    expect(draws(1234, 8)).toEqual(draws(1234, 8));
  });

  it("gives a different sequence from a different seed", () => {
    expect(draws(1, 8)).not.toEqual(draws(2, 8));
  });

  it("stays inside [0, 1)", () => {
    for (const value of draws(99, 200)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("returns the generator's next state beside the draw", () => {
    const [, next] = nextRandom(7);
    expect(next).not.toBe(7);
    expect(Number.isInteger(next)).toBe(true);
  });

  it("is a pure function of the state it is given", () => {
    expect(nextRandom(7)).toEqual(nextRandom(7));
  });
});

describe("nextSign", () => {
  it("returns only +1 or -1", () => {
    let state = 5;
    for (let i = 0; i < 100; i++) {
      const [sign, next] = nextSign(state);
      expect(Math.abs(sign)).toBe(1);
      state = next;
    }
  });

  it("produces both signs over a run of draws", () => {
    const signs = new Set<number>();
    let state = 5;
    for (let i = 0; i < 50; i++) {
      const [sign, next] = nextSign(state);
      signs.add(sign);
      state = next;
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });
});
