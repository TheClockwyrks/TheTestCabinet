// Spectra — every figure the game scores (specs/scoring.md, specs/progression.md).
//
// What a destroyed drone pays depends on its kind and on the phase it was in, and
// a drone destroyed while entering, diving or returning — by a bullet or by a
// discharge alike — pays the diving figure. A challenge stage's drones pay their
// own flat figure whatever they are.
//
// The extra life lives here too, because it belongs to the SCORING PATH and to
// nothing else: a pose of the score grants nothing, whatever boundary it carries
// the score across (`specs/instrumentation.md`), so the latch is only ever read
// and written by `addScore`.

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
import type { DroneState, SpectraState } from "./game";

/** Which layer of a drone a destruction took. */
export type Layer = "shell" | "body";

/**
 * What destroying `layer` of `drone` pays.
 *
 * A Prism's shell and its exposed core carry their own figures in every phase; a
 * Shard and a Flux pay their formation figure in the formation and their diving
 * figure everywhere else.
 */
export function droneScore(
  state: SpectraState,
  drone: DroneState,
  layer: Layer,
): number {
  if (isChallengeStage(state.stage)) return SCORE_CHALLENGE_DRONE;
  if (drone.kind === "prism") {
    return layer === "shell" ? SCORE_PRISM_SHELL : SCORE_PRISM_CORE;
  }
  const resting = drone.phase === "formation";
  if (drone.kind === "flux") return resting ? SCORE_FLUX_FORM : SCORE_FLUX_DIVE;
  return resting ? SCORE_SHARD_FORM : SCORE_SHARD_DIVE;
}

/**
 * Add `amount` to the score, paying the run's one extra life if this is the
 * crossing that earns it.
 *
 * The run carries a latch: while it is true no further life is paid, whatever the
 * score does afterwards.
 */
export function addScore(state: SpectraState, amount: number): void {
  state.score += amount;
  if (state.extraLifeAwarded) return;
  if (state.score < EXTRA_LIFE_AT) return;
  state.lives += 1;
  state.extraLifeAwarded = true;
}
