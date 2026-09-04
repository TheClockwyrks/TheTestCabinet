// Spectra — every figure the game scores (`specs/scoring.md`), and the run's one
// extra life (`specs/progression.md`).
//
// What a destroyed drone pays depends on its kind and on the phase it was in,
// and a drone destroyed by a discharge wave pays exactly what one destroyed by a
// bullet in that phase pays. One drone of a challenge stage pays its own figure,
// whatever kind it is.
//
// The extra life is paid by `award`, and by nothing else: the latch it reads is
// declared state (`extraLifeAwarded`), so a debug pose of the score cannot pay
// it and posing the score down and back up cannot re-arm it.

import {
  EXTRA_LIFE_AT,
  SCORE_CHALLENGE_DRONE,
  SCORE_FLUX_DIVE,
  SCORE_FLUX_FORM,
  SCORE_PRISM_CORE,
  SCORE_PRISM_SHELL,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  isChallengeStage,
} from "./constants";
import type { DronePhase, DroneKind, SpectraState } from "./game";

/** What destroying a drone of `kind` in `phase` pays at `stage`. */
export function droneScore(
  kind: DroneKind,
  phase: DronePhase,
  stage: number,
): number {
  if (isChallengeStage(stage)) return SCORE_CHALLENGE_DRONE;
  const inFormation = phase === "formation";
  switch (kind) {
    case "shard":
      return inFormation ? SCORE_SHARD_FORM : SCORE_SHARD_DIVE;
    case "flux":
      return inFormation ? SCORE_FLUX_FORM : SCORE_FLUX_DIVE;
    case "prism":
      // The exposed core, in any phase. A Prism's shell is scored on its own,
      // by `SCORE_PRISM_SHELL`, when the shell is what fell.
      return SCORE_PRISM_CORE;
  }
}

/** What breaking a Prism's shell pays, in any phase. */
export function shellScore(stage: number): number {
  return isChallengeStage(stage) ? SCORE_CHALLENGE_DRONE : SCORE_PRISM_SHELL;
}

/**
 * Add `points` to the score, paying the run's single extra life if this is the
 * crossing that earns it.
 *
 * The latch is what makes the award once-only: it is compared and set here, so a
 * score that falls and rises again pays nothing further.
 */
export function award(state: SpectraState, points: number): void {
  state.score += points;
  if (!state.extraLifeAwarded && state.score >= EXTRA_LIFE_AT) {
    state.extraLifeAwarded = true;
    state.lives += 1;
  }
}
