// Wireworm — the score and the bonus life it earns (specs/scoring.md).
//
// Every figure the run is paid goes through {@link addScore}, and that is the
// whole reason this is its own module: the bonus life is granted on CROSSING a
// multiple of `BONUS_LIFE_EVERY`, so it has to be decided where the score
// changes rather than watched for afterwards, and one award that carries the
// score over more than one multiple grants a life for each.
//
// The debug surface's `setScore` deliberately does NOT come through here. A pose
// is a precondition, not a scoring event, so it moves the milestone past the
// posed figure instead of paying out along the way; {@link poseScore} is that.

import { BONUS_LIFE_EVERY } from "./constants";
import type { WirewormState } from "./types";

/** Pay `points` into the run's score, granting a life at every multiple crossed. */
export function addScore(state: WirewormState, points: number): void {
  state.score += points;
  while (state.score >= state.nextBonus) {
    state.lives += 1;
    state.nextBonus += BONUS_LIFE_EVERY;
  }
}

/**
 * Set the score directly, as a precondition.
 *
 * The next milestone is moved to the first multiple above the posed figure, so
 * the next real award still grants a life at the next boundary and the pose
 * itself grants none.
 */
export function poseScore(state: WirewormState, score: number): void {
  state.score = score;
  state.nextBonus =
    (Math.floor(score / BONUS_LIFE_EVERY) + 1) * BONUS_LIFE_EVERY;
}
