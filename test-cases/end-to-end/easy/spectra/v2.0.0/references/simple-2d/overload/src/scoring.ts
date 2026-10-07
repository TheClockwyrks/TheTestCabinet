// Spectra — every figure the game scores (`specs/scoring.md`,
// `specs/progression.md`).
//
// What a destroyed drone pays depends on its kind and on the phase it was in, and
// a drone a discharge wave destroys pays the same as one a bullet destroys in that
// phase. The run's one extra life is paid from here, because the award belongs to
// the scoring path: a pose of the score is a precondition and grants nothing.

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
import type { MutDrone, Sim } from "./sim";

/**
 * Add to the score, paying the run's one extra life as the threshold is crossed.
 *
 * The latch is what makes it one life: once it stands, no further life is paid
 * whatever the score does afterwards.
 */
export function addScore(sim: Sim, points: number): void {
  sim.score += points;
  if (!sim.extraLifeAwarded && sim.score >= EXTRA_LIFE_AT) {
    sim.lives += 1;
    sim.extraLifeAwarded = true;
  }
}

/** What breaking a Prism's shell pays. */
export function shellValue(): number {
  return SCORE_PRISM_SHELL;
}

/** What destroying the drone outright pays, from where it stands. */
export function killValue(sim: Sim, drone: MutDrone): number {
  if (isChallengeStage(sim.stage)) return SCORE_CHALLENGE_DRONE;
  const resting = drone.phase === "formation";
  switch (drone.kind) {
    case "shard":
      return resting ? SCORE_SHARD_FORM : SCORE_SHARD_DIVE;
    case "flux":
      return resting ? SCORE_FLUX_FORM : SCORE_FLUX_DIVE;
    case "prism":
      // A Prism taken whole pays its shell and its core together.
      return drone.shellAlive
        ? SCORE_PRISM_SHELL + SCORE_PRISM_CORE
        : SCORE_PRISM_CORE;
  }
}
