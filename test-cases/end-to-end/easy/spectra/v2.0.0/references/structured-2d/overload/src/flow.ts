// Spectra — the run: the screens it moves between, the lives it carries, and the
// stage ladder (specs/ui.md, specs/progression.md, specs/stages.md).
//
// Every screen is a value of the state's `screen` field, so the world is never
// rebuilt and the field survives a stage advance. The three holds — the stage
// intro, the stage-cleared interstitial and the ready beat — are one countdown
// each against `phaseTimer`, and what each runs out into is here.
//
// `reset` is here too, because restoring the title-screen values is the same act
// as opening the game: it is the declared state, field by field, back to the value
// its initializer gives it (`specs/instrumentation.md`).

import {
  CHALLENGE_GROUPS,
  CHALLENGE_TOTAL,
  ENTER_GROUP_GAP,
  DIVE_FIRST_DELAY,
  READY_HOLD,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  isChallengeStage,
} from "./constants";
import { LANE_CENTER } from "./ship";
import { addScore } from "./scoring";
import { buildWave } from "./waves";
import type { FrameCues } from "./audio";
import type { SpectraState } from "./game";

/** Empty every roster and put out the live discharge. */
function clearField(state: SpectraState): void {
  state.drones = [];
  state.bullets = [];
  state.bursts = [];
  state.discharge.active = false;
  state.discharge.radius = 0;
}

/** Return the wave's own clocks to their fresh-wave values. */
function freshWaveClocks(state: SpectraState): void {
  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.diveTarget = DIVE_FIRST_DELAY;
}

/** Put the ship back at the centre of its lane, on the cyan band, quiet. */
function freshShip(state: SpectraState): void {
  state.ship.x = LANE_CENTER;
  state.ship.band = "cyan";
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
}

/**
 * Restore every declared field to its title-screen value. `muted` is left exactly
 * as it stands, because muting is a player preference the runtime owns.
 */
export function resetState(state: SpectraState): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.extraLifeAwarded = false;
  state.challengeHits = 0;
  state.resonance = 0;
  state.inversion = 0;
  clearField(state);
  freshShip(state);
  state.ship.contact = true;
  state.waveEntry = true;
  state.diveLaunching = true;
  state.stageClearing = true;
  freshWaveClocks(state);
  state.nextId = 1;
  state.simTime = 0;
}

/**
 * Back to the title, with its highlight on the entry that led away from it.
 *
 * `specs/ui.md`: the mode entry after a run, `HOW TO PLAY` after the how-to-play
 * screen.
 */
export function toTitle(state: SpectraState, index = 0): void {
  state.screen = "title";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = index;
}

/** Open the current stage's intro hold, over an empty field. */
export function enterStageIntro(state: SpectraState): void {
  state.screen = "stageIntro";
  state.phase = "live";
  state.phaseTimer = STAGE_INTRO_HOLD;
  state.menuIndex = 0;
  clearField(state);
  freshWaveClocks(state);
}

/** Open a fresh run: stage one, `START_LIVES` lives, and a score of zero. */
export function startRun(state: SpectraState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.extraLifeAwarded = false;
  state.challengeHits = 0;
  state.resonance = 0;
  state.inversion = 0;
  freshShip(state);
  enterStageIntro(state);
}

/** Give way from the stage intro to the live wave, building the stage's wave. */
export function enterWave(state: SpectraState): void {
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  buildWave(state);
}

/** Open the stage-cleared interstitial. */
function enterStageCleared(state: SpectraState, cues: FrameCues): void {
  state.screen = "stageCleared";
  state.phase = "live";
  state.phaseTimer = STAGE_CLEARED_HOLD;
  state.menuIndex = 0;
  cues.stageClear = true;
}

/** A standard stage has cleared: pay its bonus and open the interstitial. */
export function clearStage(state: SpectraState, cues: FrameCues): void {
  addScore(state, SCORE_STAGE_CLEAR);
  enterStageCleared(state, cues);
}

/**
 * A challenge stage is over: pay the perfect bonus if every one of its drones was
 * destroyed, and open the interstitial. A challenge stage pays no stage bonus.
 */
export function endChallengeStage(state: SpectraState, cues: FrameCues): void {
  if (state.challengeHits >= CHALLENGE_TOTAL) {
    addScore(state, SCORE_PERFECT_BONUS);
  }
  enterStageCleared(state, cues);
}

/** The interstitial has given way: the next stage's intro, one number higher. */
export function advanceStage(state: SpectraState): void {
  state.stage += 1;
  enterStageIntro(state);
}

/**
 * Lose one life.
 *
 * With lives to spare the live wave enters its `ready` phase for `READY_HOLD`,
 * carrying on where it was; with none left the run ends and the game-over screen
 * opens. One event costs exactly one life, whatever else is on the field.
 */
export function loseLife(state: SpectraState, cues: FrameCues): void {
  state.lives -= 1;
  cues.hit = true;
  if (state.lives <= 0) {
    state.lives = 0;
    state.screen = "gameOver";
    state.phase = "live";
    state.phaseTimer = 0;
    state.menuIndex = 0;
    return;
  }
  state.phase = "ready";
  state.phaseTimer = READY_HOLD;
}

/** The ready hold has run: the ship reappears at the centre of its lane. */
export function endReadyHold(state: SpectraState): void {
  state.phase = "live";
  state.phaseTimer = 0;
  state.ship.x = LANE_CENTER;
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
}

/**
 * Whether the stage the run is on has finished, given how many drones this
 * sub-step removed.
 *
 * A standard stage clears on the moment the last drone of its wave is destroyed,
 * so a live wave that holds no drone and has had none removed is being played
 * rather than cleared. A challenge stage ends once every one of its groups has
 * been released and none of its drones is left on the field.
 */
export function checkStageEnd(
  state: SpectraState,
  removed: number,
  cues: FrameCues,
): void {
  if (state.screen !== "inWave") return;
  if (!state.stageClearing) return;

  if (isChallengeStage(state.stage)) {
    if (state.drones.length > 0) return;
    if (!challengeFullyReleased(state)) return;
    endChallengeStage(state, cues);
    return;
  }

  if (removed > 0 && state.drones.length === 0) clearStage(state, cues);
}

/** Whether a challenge stage has released every one of its groups. */
function challengeFullyReleased(state: SpectraState): boolean {
  return state.entryClock >= ENTER_GROUP_GAP * (CHALLENGE_GROUPS - 1);
}

/** The screens that run a hold, and what each one gives way to. */
export function advanceHold(state: SpectraState, h: number): void {
  state.phaseTimer = Math.max(0, state.phaseTimer - h);
  if (state.phaseTimer > 0) return;
  if (state.screen === "stageIntro") enterWave(state);
  else if (state.screen === "stageCleared") advanceStage(state);
}
