// The seeded generator is the whole of Carom's randomness, and
// `specs/instrumentation.md` requires that reseeding and replaying reproduce a
// scenario exactly — so what is checked here is reproducibility, not the
// statistics of the draw.

import { describe, expect, it } from "vitest";
import { nextAngle, nextRandom } from "./rng";

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

describe("nextAngle", () => {
  it("stays inside [0, 2π)", () => {
    let state = 5;
    for (let i = 0; i < 200; i++) {
      const [angle, next] = nextAngle(state);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
      state = next;
    }
  });

  it("covers the whole circle over a run of draws", () => {
    // A launch can leave toward either goal and either wall (specs/balls.md),
    // so the draw must reach all four quadrants.
    const quadrants = new Set<number>();
    let state = 5;
    for (let i = 0; i < 100; i++) {
      const [angle, next] = nextAngle(state);
      quadrants.add(Math.floor(angle / (Math.PI / 2)));
      state = next;
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("threads the same state as the raw draw", () => {
    const [value, rawNext] = nextRandom(11);
    const [angle, next] = nextAngle(11);
    expect(angle).toBeCloseTo(value * 2 * Math.PI, 12);
    expect(next).toBe(rawNext);
  });
});
