// Spectra — the stage sequence, the challenge flyover, and the clear transition.
//
// `specs/stages.md` states the clear as a TRANSITION rather than as a predicate: a
// standard stage clears in the moment the LAST DRONE OF ITS WAVE is destroyed, so a
// live wave that holds no drone and has had none removed is being played rather than
// cleared.
//
// That distinction is the reason a drone carries `ofWave` and the state carries
// `waveOpen`. A wave the stage built opens with at least one drone and closes when
// the last of THOSE is gone; a drone placed on the field from outside the wave — by
// the debug surface, or as an overloaded Prism's escort of a wave that was never
// built — is not one of them, so destroying it clears nothing and a wave that never
// held a drone never clears.

import {
  CHALLENGE_TOTAL,
  CUES,
  DIVE_FIRST_DELAY,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  isChallengeStage,
} from "./constants";
import { award } from "./scoring";
import { buildChallenge, buildWave } from "./waves";
import type { CueSink } from "./audio";
import type { SpectraState } from "./types";

/**
 * Build the stage's wave and open it.
 *
 * Called in the moment the stage-intro hold gives way, which is the only moment a
 * wave is ever built: no drone exists during that hold. Every clock the wave keeps
 * returns to its fresh-wave value here.
 */
export function buildStageWave(state: SpectraState): void {
  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.nextDiveGap = DIVE_FIRST_DELAY;
  state.challengeHits = 0;
  if (isChallengeStage(state.stage)) buildChallenge(state);
  else buildWave(state, state.stage);
  state.waveOpen = state.drones.some((drone) => drone.ofWave);
}

/** Whether any drone of the stage's own wave is still standing. */
export function waveStanding(state: SpectraState): boolean {
  return state.drones.some((drone) => drone.ofWave);
}

/**
 * Close the stage if the wave the stage built has just run out of drones.
 *
 * Called after every game-driven removal — a destruction, and a challenge drone
 * leaving the field — and never after a debug removal, which is what keeps a posed
 * scenario from clearing a stage it was never playing.
 */
export function closeStageIfWaveGone(state: SpectraState, cues: CueSink): void {
  if (!state.waveOpen || state.screen !== "inWave") return;
  if (waveStanding(state)) return;
  clearStage(state, cues);
}

/** Pay the finished stage's bonus and open its interstitial. */
export function clearStage(state: SpectraState, cues: CueSink): void {
  state.waveOpen = false;
  if (isChallengeStage(state.stage)) {
    // A challenge stage pays no stage-clear bonus, and the perfect bonus only when
    // every one of its drones was destroyed.
    if (state.challengeHits >= CHALLENGE_TOTAL)
      award(state, SCORE_PERFECT_BONUS);
  } else {
    award(state, SCORE_STAGE_CLEAR);
  }
  state.screen = "stageCleared";
  state.phase = "live";
  state.phaseTimer = STAGE_CLEARED_HOLD;
  cues.raise(CUES.stageClear);
}

/** Open the intro of the stage the game is about to play. */
export function openStageIntro(state: SpectraState): void {
  state.screen = "stageIntro";
  state.phase = "live";
  state.phaseTimer = STAGE_INTRO_HOLD;
  state.drones = [];
  state.bullets = [];
  state.waveOpen = false;
}

/** Move on from the stage-cleared interstitial, one stage higher. */
export function openNextStage(state: SpectraState): void {
  state.stage += 1;
  openStageIntro(state);
}

/** Open the live wave the stage-intro hold has just given way to. */
export function openLiveWave(state: SpectraState): void {
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  buildStageWave(state);
}
