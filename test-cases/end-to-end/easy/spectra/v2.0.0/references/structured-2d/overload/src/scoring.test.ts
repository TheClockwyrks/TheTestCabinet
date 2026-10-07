import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TOTAL,
  EXTRA_LIFE_AT,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PERFECT_BONUS,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SCORE_STAGE_CLEAR,
  START_LIVES,
} from "./constants";
import { addPlayerBulletTo } from "./bullets";
import { resolveContacts } from "./contacts";
import { noCues } from "./audio";
import { addScore, droneScore } from "./scoring";
import { liveState, poseDrone } from "./fixtures";
import { clearStage, endChallengeStage } from "./flow";
import type { DroneKind, DronePhase } from "./game";

function kill(
  kind: DroneKind,
  phase: DronePhase,
  band: "cyan" | "magenta" = "cyan",
) {
  const state = liveState();
  poseDrone(state, kind, 400, 200, { phase });
  addPlayerBulletTo(state, 400, 200, band);
  resolveContacts(state, noCues());
  return state;
}

describe("what a destroyed drone pays", () => {
  it("pays a Shard its formation and its diving figures", () => {
    expect(kill("shard", "formation").score).toBe(SCORE_SHARD_FORM);
    expect(kill("shard", "diving").score).toBe(SCORE_SHARD_DIVE);
    expect(kill("shard", "entering").score).toBe(SCORE_SHARD_DIVE);
    expect(kill("shard", "returning").score).toBe(SCORE_SHARD_DIVE);
  });

  it("pays a Flux its own two figures", () => {
    expect(kill("flux", "formation").score).toBe(SCORE_FLUX_FORM);
    expect(kill("flux", "diving").score).toBe(SCORE_FLUX_DIVE);
  });

  it("pays a Prism's shell and its core apart", () => {
    const state = liveState();
    const prism = poseDrone(state, "prism", 400, 200);
    addPlayerBulletTo(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.score).toBe(SCORE_PRISM_SHELL);
    addPlayerBulletTo(state, 400, 200, "magenta");
    resolveContacts(state, noCues());
    expect(state.score).toBe(SCORE_PRISM_SHELL + SCORE_PRISM_CORE);
    expect(prism.id).toBe(1);
  });

  it("pays a challenge drone its own flat figure", () => {
    const state = liveState();
    state.stage = 3;
    poseDrone(state, "shard", 400, 200, { phase: "entering" });
    addPlayerBulletTo(state, 400, 200, "cyan");
    resolveContacts(state, noCues());
    expect(state.score).toBe(SCORE_CHALLENGE_DRONE);
    expect(state.challengeHits).toBe(1);
  });

  it("reads a figure straight from the kind and the phase", () => {
    const state = liveState();
    const flux = poseDrone(state, "flux", 0, 0, { phase: "returning" });
    expect(droneScore(state, flux, "body")).toBe(SCORE_FLUX_DIVE);
  });
});

describe("the bonuses", () => {
  it("pays a stage clear its bonus", () => {
    const state = liveState();
    clearStage(state, noCues());
    expect(state.score).toBe(SCORE_STAGE_CLEAR);
  });

  it("pays a perfect challenge stage its bonus and no stage bonus", () => {
    const state = liveState();
    state.stage = 3;
    state.challengeHits = CHALLENGE_TOTAL;
    endChallengeStage(state, noCues());
    expect(state.score).toBe(SCORE_PERFECT_BONUS);
  });

  it("pays nothing extra when a challenge drone survived", () => {
    const state = liveState();
    state.stage = 3;
    state.challengeHits = CHALLENGE_TOTAL - 1;
    endChallengeStage(state, noCues());
    expect(state.score).toBe(0);
  });
});

describe("the extra life", () => {
  it("is paid once, when the score first reaches the threshold", () => {
    const state = liveState();
    addScore(state, EXTRA_LIFE_AT - 1);
    expect(state.lives).toBe(START_LIVES);
    expect(state.extraLifeAwarded).toBe(false);
    addScore(state, 1);
    expect(state.lives).toBe(START_LIVES + 1);
    expect(state.extraLifeAwarded).toBe(true);
  });

  it("is not paid again, whatever the score does afterwards", () => {
    const state = liveState();
    state.extraLifeAwarded = true;
    state.score = EXTRA_LIFE_AT - 10;
    addScore(state, 1000);
    expect(state.lives).toBe(START_LIVES);
  });

  it("is not paid by a scoring event below the threshold", () => {
    const state = liveState();
    addScore(state, 10);
    expect(state.lives).toBe(START_LIVES);
    expect(state.extraLifeAwarded).toBe(false);
  });
});
