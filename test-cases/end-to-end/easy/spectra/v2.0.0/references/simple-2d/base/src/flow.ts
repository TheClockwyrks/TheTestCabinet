// Spectra — the seven screens, the menus, and the shape of a run
// (`specs/ui.md`, `specs/progression.md`, `specs/stages.md`).
//
// The game is on exactly one screen at a time, and every move between two of
// them is a function here. A run's own beats live here too: the stage-intro hold
// that builds a wave as it gives way, the ready hold a lost life opens, the
// interstitial a cleared stage opens, and the end of a run.
//
// `openingState` is the whole of the opening state, built in one go, so every
// field of `SpectraState` is present before a frame can observe one, and
// `resetToTitle` is the same values written over a state that has been played,
// which is what makes the debug surface's `reset` enough to pose a scenario from
// a clean field.

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
import { emptyArt, type Art } from "./assets";
import { LANE_CENTER } from "./ship";
import { award } from "./scoring";
import { buildWave } from "./waves";
import type { FrameEvents, Sim } from "./sim";
import type { SpectraState } from "./game";

/** How many items the screen's menu holds, or `0` where it has none. */
export function menuLength(screen: SpectraState["screen"]): number {
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

/** The opening state: the title screen, with every field at its title value. */
export function openingState(art: Art): SpectraState {
  return {
    screen: "title",
    phase: "live",
    phaseTimer: 0,
    menuIndex: 0,

    score: 0,
    lives: START_LIVES,
    stage: 1,
    extraLifeAwarded: false,
    challengeHits: 0,

    resonance: 0,
    inversion: 0,

    ship: {
      x: LANE_CENTER,
      band: "cyan",
      lockout: 0,
      cooldown: 0,
      contact: true,
    },
    discharge: { active: false, radius: 0 },

    drones: [],
    bullets: [],
    bursts: [],

    waveEntry: true,
    diveLaunching: true,
    stageClearing: true,
    entryClock: 0,
    swayClock: 0,
    diveClock: 0,
    diveTarget: DIVE_FIRST_DELAY,

    nextId: 1,
    simTime: 0,
    muted: false,

    art,
  };
}

/** The opening state with no art, which is what a host with no page gets. */
export function bareOpeningState(): SpectraState {
  return openingState(emptyArt());
}

/**
 * Restore every declared field to its title-screen value.
 *
 * `muted` is left exactly as it stands, because muting is a player preference the
 * runtime owns, and the art is left alone because it is not the game's state.
 */
export function resetToTitle(sim: Sim): void {
  const opening = openingState(sim.art);
  sim.screen = opening.screen;
  sim.phase = opening.phase;
  sim.phaseTimer = opening.phaseTimer;
  sim.menuIndex = opening.menuIndex;

  sim.score = opening.score;
  sim.lives = opening.lives;
  sim.stage = opening.stage;
  sim.extraLifeAwarded = opening.extraLifeAwarded;
  sim.challengeHits = opening.challengeHits;

  sim.resonance = opening.resonance;
  sim.inversion = opening.inversion;

  sim.ship = { ...opening.ship };
  sim.discharge = { ...opening.discharge };

  sim.drones = [];
  sim.bullets = [];
  sim.bursts = [];

  sim.waveEntry = opening.waveEntry;
  sim.diveLaunching = opening.diveLaunching;
  sim.stageClearing = opening.stageClearing;
  sim.entryClock = opening.entryClock;
  sim.swayClock = opening.swayClock;
  sim.diveClock = opening.diveClock;
  sim.diveTarget = opening.diveTarget;

  sim.nextId = opening.nextId;
  sim.simTime = opening.simTime;
}

/**
 * Open a new run: stage 1, `START_LIVES` lives, a score of `0`, and its intro.
 *
 * The run's own figures go back to their opening values and nothing else does: a
 * new run does not rewind the accumulated simulation time or the id counter.
 */
export function startRun(sim: Sim): void {
  sim.score = 0;
  sim.lives = START_LIVES;
  sim.stage = 1;
  sim.extraLifeAwarded = false;
  sim.challengeHits = 0;

  sim.resonance = 0;
  sim.inversion = 0;

  sim.ship = {
    x: LANE_CENTER,
    band: "cyan",
    lockout: 0,
    cooldown: 0,
    contact: sim.ship.contact,
  };
  sim.discharge = { active: false, radius: 0 };

  sim.drones = [];
  sim.bullets = [];
  sim.bursts = [];

  sim.entryClock = 0;
  sim.swayClock = 0;
  sim.diveClock = 0;
  sim.diveTarget = DIVE_FIRST_DELAY;

  sim.screen = "stageIntro";
  sim.phase = "live";
  sim.phaseTimer = STAGE_INTRO_HOLD;
  sim.menuIndex = 0;
}

/** Open the live wave, building the stage's wave as the intro gives way. */
export function openWave(sim: Sim): void {
  sim.screen = "inWave";
  sim.phase = "live";
  sim.phaseTimer = 0;
  sim.menuIndex = 0;
  buildWave(sim);
}

/** Open the next stage's intro, one stage higher than the one just finished. */
export function openNextStage(sim: Sim): void {
  sim.stage += 1;
  sim.screen = "stageIntro";
  sim.phase = "live";
  sim.phaseTimer = STAGE_INTRO_HOLD;
  sim.drones = [];
  sim.bullets = [];
}

/**
 * The stage cleared, in the moment its wave's last drone left it.
 *
 * A standard stage pays `SCORE_STAGE_CLEAR`. A challenge stage pays no clear
 * bonus, and pays `SCORE_PERFECT_BONUS` only where every one of its drones was
 * destroyed.
 */
export function clearStage(sim: Sim, events: FrameEvents): void {
  if (isChallengeStage(sim.stage)) {
    if (sim.challengeHits >= CHALLENGE_TOTAL) award(sim, SCORE_PERFECT_BONUS);
  } else {
    award(sim, SCORE_STAGE_CLEAR);
  }
  sim.bullets = [];
  sim.screen = "stageCleared";
  sim.phase = "live";
  sim.phaseTimer = STAGE_CLEARED_HOLD;
  events.cues.add("stage-clear");
}

/**
 * A life lost.
 *
 * With lives to spare the live wave enters its `ready` phase, and the wave
 * carries on where it was: every drone keeps its phase, its position and its
 * band, and any dive in progress runs on. With no life left the run ends.
 */
export function loseLife(sim: Sim, events: FrameEvents): void {
  sim.lives -= 1;
  events.cues.add("hit");
  if (sim.lives > 0) {
    sim.phase = "ready";
    sim.phaseTimer = READY_HOLD;
    return;
  }
  sim.lives = 0;
  sim.screen = "gameOver";
  sim.phase = "live";
  sim.phaseTimer = 0;
  sim.menuIndex = 0;
}

/** The ready hold over: the ship is back at the centre of its lane. */
export function endReadyHold(sim: Sim): void {
  sim.phase = "live";
  sim.phaseTimer = 0;
  sim.ship.x = LANE_CENTER;
  sim.ship.lockout = 0;
  sim.ship.cooldown = 0;
}
