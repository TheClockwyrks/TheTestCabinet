// Spectra — the seven screens, the menus, and the shape of a run
// (`specs/ui.md`, `specs/progression.md`, `specs/stages.md`).
//
// The game is on exactly one screen at a time, and every move between two of
// them is a function here. A run's own beats live here too: the stage-intro hold
// that builds a wave as it gives way, the ready hold a lost life opens, the
// interstitial a cleared stage opens, and the end of a run.
//
// `resetToTitle` writes every declared field of the live state back to its
// title-screen value — the same value each field's initializer on `SpectraState`
// carries — which is what makes the debug surface's `reset` enough to replay a
// scenario exactly. `muted` is left exactly as it stands, because muting is a
// player preference the runtime owns.

import {
  DIVE_FIRST_DELAY,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  READY_HOLD,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
  CHALLENGE_TOTAL,
  isChallengeStage,
} from "./constants";
import { LANE_CENTER } from "./ship";
import { award } from "./scoring";
import { seedState } from "./rng";
import { buildWave } from "./waves";
import type { FrameEvents } from "./events";
import type { Screen, SpectraState } from "./game";

/** How many items the screen's menu holds, or `0` where it has none. */
export function menuLength(screen: Screen): number {
  switch (screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "gameOver":
      return GAME_OVER_ITEMS.length;
    default:
      return 0;
  }
}

/**
 * Restore every declared field to its title-screen value, seeding the game's
 * randomness from `seed`.
 *
 * The declaration on `SpectraState` is the list, and this writes the same values
 * over a state that has been played. `muted` is left alone.
 */
export function resetToTitle(state: SpectraState, seed: number): void {
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

  state.ship = {
    x: LANE_CENTER,
    band: "cyan",
    lockout: 0,
    cooldown: 0,
    contact: true,
  };
  state.discharge = { active: false, radius: 0 };

  state.drones = [];
  state.bullets = [];
  state.bursts = [];

  state.waveEntry = true;
  state.diveLaunching = true;
  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.diveTarget = DIVE_FIRST_DELAY;

  state.nextId = 1;
  state.simTime = 0;
  state.rngState = seedState(seed);
}

/**
 * Open a new run: stage 1, `START_LIVES` lives, a score of `0`, and its intro.
 *
 * The run's own figures go back to their opening values and nothing else does. A
 * new run does not re-seed the generator — seeding is what `reset` is for, so a
 * second run in one session draws on rather than replaying the first — and it
 * does not rewind the accumulated simulation time or the id counter.
 */
export function startRun(state: SpectraState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.stage = 1;
  state.extraLifeAwarded = false;
  state.challengeHits = 0;

  state.resonance = 0;
  state.inversion = 0;

  state.ship = {
    x: LANE_CENTER,
    band: "cyan",
    lockout: 0,
    cooldown: 0,
    contact: state.ship.contact,
  };
  state.discharge = { active: false, radius: 0 };

  state.drones = [];
  state.bullets = [];
  state.bursts = [];

  state.entryClock = 0;
  state.swayClock = 0;
  state.diveClock = 0;
  state.diveTarget = DIVE_FIRST_DELAY;

  state.screen = "stageIntro";
  state.phase = "live";
  state.phaseTimer = STAGE_INTRO_HOLD;
  state.menuIndex = 0;
}

/** Open the live wave, building the stage's wave as the intro gives way. */
export function openWave(state: SpectraState): void {
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
  buildWave(state);
}

/** Open the next stage's intro, one stage higher than the one just finished. */
export function openNextStage(state: SpectraState): void {
  state.stage += 1;
  state.screen = "stageIntro";
  state.phase = "live";
  state.phaseTimer = STAGE_INTRO_HOLD;
  state.drones = [];
  state.bullets = [];
}

/**
 * The stage cleared, in the moment its wave's last drone left it.
 *
 * A standard stage pays `SCORE_STAGE_CLEAR`. A challenge stage pays no clear
 * bonus, and pays `SCORE_PERFECT_BONUS` only where every one of its drones was
 * destroyed.
 */
export function clearStage(state: SpectraState, events: FrameEvents): void {
  if (isChallengeStage(state.stage)) {
    if (state.challengeHits >= CHALLENGE_TOTAL) {
      award(state, SCORE_PERFECT_BONUS);
    }
  } else {
    award(state, SCORE_STAGE_CLEAR);
  }
  state.bullets = [];
  state.screen = "stageCleared";
  state.phase = "live";
  state.phaseTimer = STAGE_CLEARED_HOLD;
  events.cues.add("stage-clear");
}

/**
 * A life lost.
 *
 * With lives to spare the live wave enters its `ready` phase, and the wave
 * carries on where it was: every drone keeps its phase, its position and its
 * band, and any dive in progress runs on. With no life left the run ends.
 */
export function loseLife(state: SpectraState, events: FrameEvents): void {
  state.lives -= 1;
  events.cues.add("hit");
  if (state.lives > 0) {
    state.phase = "ready";
    state.phaseTimer = READY_HOLD;
    return;
  }
  state.lives = 0;
  state.screen = "gameOver";
  state.phase = "live";
  state.phaseTimer = 0;
  state.menuIndex = 0;
}

/** The ready hold over: the ship is back at the centre of its lane. */
export function endReadyHold(state: SpectraState): void {
  state.phase = "live";
  state.phaseTimer = 0;
  state.ship.x = LANE_CENTER;
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
}
