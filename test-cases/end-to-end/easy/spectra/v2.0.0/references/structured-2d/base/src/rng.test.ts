// The one seeded generator, and the reproducibility that rests on it.

import { describe, expect, it } from "vitest";
import { nextState, seedState, unit } from "./rng";
import { random, randomBetween, randomIndex } from "./entities";
import { liveWave } from "./fixtures";

describe("the seeded generator", () => {
  it("never lands on the state xorshift is stuck at", () => {
    expect(seedState(0)).not.toBe(0);
    expect(nextState(0)).not.toBe(0);
  });

  it("draws in [0, 1)", () => {
    let state = seedState(7);
    for (let i = 0; i < 500; i++) {
      state = nextState(state);
      const value = unit(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps its whole state in the game's own field", () => {
    const state = liveWave();
    const before = state.rngState;
    const drawn = random(state);
    expect(state.rngState).not.toBe(before);

    const replay = liveWave();
    expect(random(replay)).toBe(drawn);
  });

  it("replays the same sequence from the same seed", () => {
    const a = liveWave();
    const b = liveWave();
    const drawsA = Array.from({ length: 20 }, () => random(a));
    const drawsB = Array.from({ length: 20 }, () => random(b));
    expect(drawsA).toEqual(drawsB);
  });

  it("draws between bounds and inside a count", () => {
    const state = liveWave();
    for (let i = 0; i < 200; i++) {
      const value = randomBetween(state, 1.4, 2.6);
      expect(value).toBeGreaterThanOrEqual(1.4);
      expect(value).toBeLessThan(2.6);
      const index = randomIndex(state, 5);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
      expect(Number.isInteger(index)).toBe(true);
    }
  });
});
