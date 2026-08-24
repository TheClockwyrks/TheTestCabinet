// The seeded generator is the whole of Carom's randomness, and
// `specs/instrumentation.md` requires that reseeding and replaying reproduce a
// scenario exactly — so what is checked here is reproducibility, not the
// statistics of the draw. A draw returns the value beside the next state, so a
// sequence is the thread of states a caller carries from one draw to the next.

import { describe, expect, it } from "vitest";
import { nextAngle, nextRandom, type Draw } from "./rng";

/** `count` draws from `seed`, each threaded from the state the last returned. */
function sequence(
  draw: (rngState: number) => Draw,
  seed: number,
  count: number,
): number[] {
  const values: number[] = [];
  let rngState = seed;
  for (let i = 0; i < count; i++) {
    const [value, next] = draw(rngState);
    values.push(value);
    rngState = next;
  }
  return values;
}

const draws = (seed: number, count: number): number[] =>
  sequence(nextRandom, seed, count);

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

  it("returns the next state beside the draw, and touches nothing else", () => {
    const [, next] = nextRandom(7);
    expect(next).not.toBe(7);
    expect(Number.isInteger(next)).toBe(true);
    // The same state draws the same value: nothing but the returned state moves.
    expect(nextRandom(7)).toEqual(nextRandom(7));
  });

  it("is a pure function of the state it is handed", () => {
    const [value, next] = nextRandom(7);
    const [again] = nextRandom(next);
    expect(again).not.toBe(value);
    expect(draws(7, 2)).toEqual([value, again]);
  });
});

describe("nextAngle", () => {
  it("stays inside the full circle", () => {
    for (const angle of sequence(nextAngle, 5, 200)) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
  });

  it("reaches every quadrant over a run of draws", () => {
    const quadrants = new Set<number>();
    for (const angle of sequence(nextAngle, 5, 200)) {
      quadrants.add(Math.floor(angle / (Math.PI / 2)));
    }
    expect(quadrants).toEqual(new Set([0, 1, 2, 3]));
  });

  it("replays the same angles from the same seed", () => {
    const angles = (seed: number): number[] => sequence(nextAngle, seed, 8);
    expect(angles(77)).toEqual(angles(77));
    expect(angles(77)).not.toEqual(angles(78));
  });

  it("advances the generator exactly as the draw under it does", () => {
    const [, afterAngle] = nextAngle(77);
    const [, afterRandom] = nextRandom(77);
    expect(afterAngle).toBe(afterRandom);
  });
});
