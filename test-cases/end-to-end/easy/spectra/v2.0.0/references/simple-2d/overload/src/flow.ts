// Spectra — the run and the screens it moves between (`specs/progression.md`,
// `specs/stages.md`, `specs/ui.md`).
//
// Everything that changes which screen is showing lives here, so the menus, the
// life-loss path, the stage-clear path and the debug surface's `reset` all take the
// same routes. Three rules in this file are worth naming:
//
//   * A wave is built in the one moment the stage-intro hold gives way, and in no
//     other, so no drone exists during that hold.
//   * A standard stage clears in the MOMENT the last drone of its wave is
//     destroyed. The clear is that removal, so a live wave that holds no drone and
//     has had none removed is being played rather than cleared.
//   * A life lost with lives to spare holds the wave in its `ready` phase and
//     leaves the field exactly where it was.

import {
  CHALLENGE_TOTAL,
  CUES,
  DEFAULT_SEED,
  DIVE_FIRST_DELAY,
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  READY_HOLD,
  SCORE_PERFECT_BONUS,
  SCORE_STAGE_CLEAR,
  SHIP_X_MAX,
  SHIP_X_MIN,
  STAGE_CLEARED_HOLD,
  STAGE_INTRO_HOLD,
  START_LIVES,
  TITLE_ITEMS,
  isChallengeStage,
} from "./constants";
import { addScore } from "./scoring";
import { buildWave } from "./wave";
import type { Art, Screen, SpectraState } from "./game";
import type { FrameEvents, Sim } from "./sim";

/** The centre of the ship's lane, where a run and every respawn place it. */
export const LANE_CENTRE = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/** The state a fresh build opens on: the title screen, with an empty field. */
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
      x: LANE_CENTRE,
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
    rngState: DEFAULT_SEED,

    art,
  };
}

/**
 * Restore every declared field to its title-screen value (the debug surface's
 * `reset`).
 *
 * `muted` is a player preference the runtime owns and is left exactly as it
 * stands, and the loaded art is left with it.
 */
export function resetToTitle(sim: Sim, seed = DEFAULT_SEED): void {
  const fresh = openingState(sim.art);
  sim.screen = fresh.screen;
  sim.phase = fresh.phase;
  sim.phaseTimer = fresh.phaseTimer;
  sim.menuIndex = fresh.menuIndex;
  sim.score = fresh.score;
  sim.lives = fresh.lives;
  sim.stage = fresh.stage;
  sim.extraLifeAwarded = fresh.extraLifeAwarded;
  sim.challengeHits = fresh.challengeHits;
  sim.resonance = fresh.resonance;
  sim.inversion = fresh.inversion;
  sim.ship = { ...fresh.ship };
  sim.discharge = { ...fresh.discharge };
  sim.drones = [];
  sim.bullets = [];
  sim.bursts = [];
  sim.waveEntry = fresh.waveEntry;
  sim.diveLaunching = fresh.diveLaunching;
  sim.stageClearing = fresh.stageClearing;
  sim.entryClock = fresh.entryClock;
  sim.swayClock = fresh.swayClock;
  sim.diveClock = fresh.diveClock;
  sim.diveTarget = fresh.diveTarget;
  sim.nextId = fresh.nextId;
  sim.simTime = 0;
  sim.rngState = seed;
}

/** Move to `screen`, with its menu's highlight back at the first item. */
export function goTo(sim: Sim, screen: Screen): void {
  sim.screen = screen;
  sim.menuIndex = 0;
}

/** The menu the current screen shows, or `null` where it shows none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameOver":
      return GAME_OVER_ITEMS;
    default:
      return null;
  }
}

/** Open a new run: stage one, full lives, no score, and the stage's intro. */
export function startRun(sim: Sim): void {
  sim.screen = "stageIntro";
  sim.phase = "live";
  sim.phaseTimer = STAGE_INTRO_HOLD;
  sim.menuIndex = 0;
  sim.score = 0;
  sim.lives = START_LIVES;
  sim.stage = 1;
  sim.extraLifeAwarded = false;
  sim.challengeHits = 0;
  sim.resonance = 0;
  sim.inversion = 0;
  sim.ship = {
    x: LANE_CENTRE,
    band: "cyan",
    lockout: 0,
    cooldown: 0,
    // The three world gates belong to the debug surface, not to the run.
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
}

/** The stage-intro hold giving way, which is when the stage's wave is built. */
export function beginWave(sim: Sim): void {
  sim.screen = "inWave";
  sim.phase = "live";
  sim.phaseTimer = 0;
  sim.menuIndex = 0;
  buildWave(sim);
}

/** A life lost: the run ends, or the wave holds for its ready beat. */
export function loseLife(sim: Sim, ev: FrameEvents): void {
  sim.lives -= 1;
  ev.cues.add(CUES.hit);

  if (sim.lives <= 0) {
    sim.lives = 0;
    goTo(sim, "gameOver");
    return;
  }

  // The wave carries on where it was: every drone keeps its phase, its position
  // and its band, and any dive in progress runs on.
  sim.phase = "ready";
  sim.phaseTimer = READY_HOLD;
}

/** The ready hold ending: the ship reappears at the centre of its lane. */
export function endReadyHold(sim: Sim): void {
  sim.phase = "live";
  sim.phaseTimer = 0;
  sim.ship.x = LANE_CENTRE;
  sim.ship.lockout = 0;
  sim.ship.cooldown = 0;
}

/** The stage cleared: its bonus is paid and the interstitial opens. */
export function clearStage(sim: Sim, ev: FrameEvents): void {
  if (isChallengeStage(sim.stage)) {
    // A challenge stage pays no stage bonus, and pays the perfect bonus only
    // where every one of its drones was destroyed.
    if (sim.challengeHits >= CHALLENGE_TOTAL)
      addScore(sim, SCORE_PERFECT_BONUS);
  } else {
    addScore(sim, SCORE_STAGE_CLEAR);
  }
  ev.cues.add(CUES.stageClear);
  sim.screen = "stageCleared";
  sim.phase = "live";
  sim.phaseTimer = STAGE_CLEARED_HOLD;
  sim.menuIndex = 0;
  sim.bullets = [];
  sim.discharge = { active: false, radius: 0 };
}

/** The interstitial giving way: the next stage's intro, one number higher. */
export function advanceStage(sim: Sim): void {
  sim.stage += 1;
  sim.screen = "stageIntro";
  sim.phase = "live";
  sim.phaseTimer = STAGE_INTRO_HOLD;
  sim.menuIndex = 0;
  sim.drones = [];
  sim.bullets = [];
  sim.inversion = 0;
}
