// Every figure the game scores, and the run's one extra life.

import { describe, expect, it } from "vitest";
import {
  EXTRA_LIFE_AT,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
} from "./constants";
import { award, droneScore, shellScore } from "./scoring";
import { liveWave } from "./fixtures";

describe("what a destroyed drone pays", () => {
  it("pays a Shard by the phase it was in", () => {
    expect(droneScore("shard", "formation", 1)).toBe(SCORE_SHARD_FORM);
    expect(droneScore("shard", "diving", 1)).toBe(SCORE_SHARD_DIVE);
    expect(droneScore("shard", "entering", 1)).toBe(SCORE_SHARD_DIVE);
    expect(droneScore("shard", "returning", 1)).toBe(SCORE_SHARD_DIVE);
  });

  it("pays a Flux by the phase it was in", () => {
    expect(droneScore("flux", "formation", 1)).toBe(SCORE_FLUX_FORM);
    expect(droneScore("flux", "diving", 1)).toBe(SCORE_FLUX_DIVE);
  });

  it("pays a Prism's core in any phase, and its shell on its own", () => {
    expect(droneScore("prism", "formation", 1)).toBe(SCORE_PRISM_CORE);
    expect(droneScore("prism", "diving", 1)).toBe(SCORE_PRISM_CORE);
    expect(shellScore(1)).toBe(SCORE_PRISM_SHELL);
  });

  it("pays one figure for any drone of a challenge stage", () => {
    expect(droneScore("shard", "entering", 3)).toBe(SCORE_CHALLENGE_DRONE);
    expect(droneScore("prism", "entering", 3)).toBe(SCORE_CHALLENGE_DRONE);
    expect(shellScore(3)).toBe(SCORE_CHALLENGE_DRONE);
  });
});

describe("the extra life", () => {
  it("is paid once, on the crossing that earns it", () => {
    const state = liveWave();
    const lives = state.lives;
    award(state, EXTRA_LIFE_AT - 1);
    expect(state.lives).toBe(lives);
    expect(state.extraLifeAwarded).toBe(false);

    award(state, 1);
    expect(state.score).toBe(EXTRA_LIFE_AT);
    expect(state.lives).toBe(lives + 1);
    expect(state.extraLifeAwarded).toBe(true);
  });

  it("pays nothing further whatever the score does afterwards", () => {
    const state = liveWave();
    award(state, EXTRA_LIFE_AT);
    const lives = state.lives;
    state.score = 0;
    award(state, EXTRA_LIFE_AT * 2);
    expect(state.lives).toBe(lives);
  });

  it("is not paid by a latch that is already true", () => {
    const state = liveWave();
    state.extraLifeAwarded = true;
    const lives = state.lives;
    award(state, EXTRA_LIFE_AT);
    expect(state.lives).toBe(lives);
  });
});
