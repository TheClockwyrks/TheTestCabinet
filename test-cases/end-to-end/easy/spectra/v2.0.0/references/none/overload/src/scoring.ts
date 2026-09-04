// Spectra — every figure the game scores, and the run's one extra life.
//
// `specs/scoring.md` fixes what each destroyed drone pays and the two bonuses;
// `specs/progression.md` fixes the extra life. They are in one file because the
// award hangs off the scoring path and nowhere else: EVERY score that a rule pays
// goes through {@link award}, so the threshold is tested exactly once per scoring
// event and a build cannot pay a life twice by scoring twice in one frame.
//
// Posing the score is deliberately NOT a scoring event (`specs/instrumentation.md`):
// `setScore` grants no life whatever boundary it crosses, and it leaves the latch
// exactly as it stands, so posing the score down and back up does not re-arm the
// award.

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
import type { Drone, SpectraState } from "./types";

/** What destroying `drone` pays, by its kind and the phase it was in. */
export function scoreForDrone(drone: Drone): number {
  if (drone.challenge) return SCORE_CHALLENGE_DRONE;
  const inFormation = drone.phase === "formation";
  if (drone.kind === "shard") {
    return inFormation ? SCORE_SHARD_FORM : SCORE_SHARD_DIVE;
  }
  if (drone.kind === "flux") {
    return inFormation ? SCORE_FLUX_FORM : SCORE_FLUX_DIVE;
  }
  // A Prism's exposed core is what "destroying the Prism" is; its shell pays
  // separately, when the shell itself breaks.
  return SCORE_PRISM_CORE;
}

/** What breaking a Prism's shell pays, in any phase. */
export function scoreForShell(): number {
  return SCORE_PRISM_SHELL;
}

/**
 * Add `points` to the score, paying the run's one extra life if this carries it
 * across `EXTRA_LIFE_AT`.
 *
 * The latch is what makes the award happen once: it is false when a run begins,
 * and while it is true no further life is paid whatever the score does afterwards.
 */
export function award(state: SpectraState, points: number): void {
  state.score += points;
  if (!state.extraLifeAwarded && state.score >= EXTRA_LIFE_AT) {
    state.extraLifeAwarded = true;
    state.lives += 1;
  }
}

/**
 * Set the score directly, granting nothing.
 *
 * The precondition half of the pair above, and the whole of what `setScore` does.
 */
export function poseScore(state: SpectraState, score: number): void {
  state.score = score;
}
