// Floe — the run, and the screens that frame it (`specs/progression.md`,
// `specs/ui.md`, `specs/bays.md`).
//
// Everything that changes which screen is showing, or that opens or ends a
// crossing, lives here, so the menus, the five deaths, the bay a crossing ends in,
// the level advance and the debug surface's `reset` all take the same routes.
//
// TWO TRANSITIONS ARE EVENTS RATHER THAN PREDICATES, and both are written that way
// on purpose (`specs/bays.md`, `specs/progression.md`):
//
//   * A LEVEL CLEARS ON THE HOP that fills its last open bay. The clear follows
//     from that hop and from nothing else, so a strait whose five bays stand filled
//     with no such hop is a level still being played — which is exactly what lets a
//     scenario pose an arbitrary bay state.
//   * A RUN ENDS ON THE DEATH that empties the lives, at the end of that death's
//     hold. `lives` posed at `0` with no death leaves the game playing, and the
//     next death is what ends it.

import {
  BAYFILL_PAUSE,
  BAY_COUNT,
  CLEAR_PAUSE,
  CUES,
  DEATH_PAUSE,
  DEFAULT_SEED,
  ENDING_ITEMS,
  PAUSE_ITEMS,
  SCORE_BAY,
  SCORE_BONUS_CATCH,
  SCORE_LEVEL,
  SCORE_TIME_BONUS,
  SCORE_VICTORY_LIFE,
  START_LIVES,
  TITLE_ITEMS,
  TOTAL_LEVELS,
  crossingTimer,
  type CueName,
} from "./constants";
import { emptySprites, type Sprites } from "./assets";
import { placeFreshCritter } from "./critter";
import { resetFish, takeFish } from "./fish";
import { emptySlots, slotDelay } from "./hunter";
import { layOutStrait } from "./lanes";
import { addScore } from "./scoring";
import { toSim, type Sim, type TickEvents } from "./sim";
import type { FloeState, Screen } from "./game";

/** How long the lunge frames stay on the strait after a bear has caught. */
export const LUNGE_HOLD = DEATH_PAUSE;

/** The state a freshly loaded build opens on: the title screen, level 1 laid out. */
export function openingState(sprites: Sprites): FloeState {
  const blank: FloeState = {
    screen: "title",
    phase: "crossing",
    phaseTimer: 0,
    menuIndex: 0,

    level: 1,
    reachedLevel: 1,
    lives: START_LIVES,
    score: 0,
    timer: crossingTimer(1),

    bays: [false, false, false, false, false],
    fishBay: null,

    critter: {
      present: false,
      x: 0,
      y: 0,
      facing: "up",
      hopCooldown: 0,
      bestRow: 0,
    },
    bears: [],

    iceLanes: [],
    waterLanes: [],
    vehicles: [],
    floes: [],

    gates: {
      bearEmergence: true,
      catchTest: true,
      fishCadence: true,
      timerRunning: true,
    },

    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,

    frameCarry: 0,
    animTime: 0,
    nextId: 1,
    slots: [],
    fishTimer: 0,
    lastFishBay: null,
    request: null,
    lunge: null,

    sprites,
  };
  const sim = toSim(blank);
  resetToTitle(sim, DEFAULT_SEED);
  return sim;
}

/** The opening state with no art at all, which is what a headless host gets. */
export function blankState(): FloeState {
  return openingState(emptySprites());
}

/**
 * Restore every declared field to its title-screen value
 * (`specs/instrumentation.md`'s `reset`).
 *
 * `muted` is a player preference the runtime owns and is left exactly as it stands,
 * and the loaded art is left with it. Everything else, the generator included, is
 * put back, so a reset leaves the game indistinguishable from one freshly started.
 */
export function resetToTitle(sim: Sim, seed: number = DEFAULT_SEED): void {
  sim.screen = "title";
  sim.phase = "crossing";
  sim.phaseTimer = 0;
  sim.menuIndex = 0;

  sim.level = 1;
  sim.reachedLevel = 1;
  sim.lives = START_LIVES;
  sim.score = 0;
  sim.timer = crossingTimer(1);

  sim.gates = {
    bearEmergence: true,
    catchTest: true,
    fishCadence: true,
    timerRunning: true,
  };

  sim.simTime = 0;
  sim.frameCarry = 0;
  sim.animTime = 0;
  sim.nextId = 1;
  sim.rngState = seed;
  sim.request = null;
  sim.lunge = null;

  sim.slots = [
    { bearId: null, fillIn: slotDelay(0) },
    { bearId: null, fillIn: slotDelay(1) },
  ];
  sim.bears = [];

  // The critter is off the strait, and reports the pose a fresh crossing begins
  // from, because that is the only pose it has ever held.
  placeFreshCritter(sim);
  sim.critter.present = false;

  openBays(sim);
  layOutStrait(sim);
}

/** Every bay open, no bonus catch out, and the next an interval away. */
export function openBays(sim: Sim): void {
  sim.bays = new Array<boolean>(BAY_COUNT).fill(false);
  resetFish(sim);
}

/** Open a fresh crossing on the current level (`specs/progression.md`). */
export function freshCrossing(sim: Sim): void {
  sim.phase = "crossing";
  sim.phaseTimer = 0;
  sim.timer = crossingTimer(sim.level);
  sim.bears = [];
  emptySlots(sim);
  placeFreshCritter(sim);
}

/** Open a new run: level one, full lives, a fresh strait, and a fresh crossing. */
export function startRun(sim: Sim): void {
  sim.screen = "playing";
  sim.menuIndex = 0;
  sim.level = 1;
  sim.reachedLevel = 1;
  sim.lives = START_LIVES;
  sim.score = 0;
  sim.lunge = null;
  openBays(sim);
  layOutStrait(sim);
  freshCrossing(sim);
}

/** The menu the current screen shows, or `null` where it shows none. */
export function menuItems(screen: Screen): readonly string[] | null {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "victory":
    case "gameover":
      return ENDING_ITEMS;
    default:
      return null;
  }
}

/** Move to `screen`, with its menu's highlight back at the first item. */
export function goTo(sim: Sim, screen: Screen): void {
  sim.screen = screen;
  sim.menuIndex = 0;
}

/** Leave the pause screen with the strait and the run exactly as they were. */
export function resume(sim: Sim): void {
  sim.screen = "playing";
  sim.menuIndex = 0;
}

/**
 * A life lost (`specs/progression.md`).
 *
 * On this tick `lives` drops by exactly one, the phase becomes `dying` for
 * `DEATH_PAUSE`, the critter leaves the strait and every bear leaves with it, so
 * nothing on the strait can reach the critter through the hold and no second life
 * is lost. The run ends when the hold expires rather than here.
 */
export function loseLife(
  sim: Sim,
  cue: CueName | null,
  events: TickEvents,
): void {
  sim.lives = Math.max(0, sim.lives - 1);
  sim.phase = "dying";
  sim.phaseTimer = DEATH_PAUSE;
  sim.critter.present = false;
  sim.bears = [];
  emptySlots(sim);
  if (cue !== null) events.cues.add(cue);
  if (sim.lives === 0) events.cues.add(CUES.gameOver);
}

/**
 * The hop that ends a crossing in an open bay (`specs/bays.md`,
 * `specs/scoring.md`).
 *
 * The bay is filled, the crossing is scored — the bay's own award, the time bonus,
 * and the bonus catch where the catch was in that bay — every bear leaves, and the
 * critter leaves the strait. A level that has run out of open bays clears from this
 * hop; otherwise a fresh crossing follows the hold.
 */
export function fillBay(sim: Sim, bay: number, events: TickEvents): void {
  sim.bays[bay] = true;
  events.cues.add(CUES.bay);

  addScore(sim, SCORE_BAY, events);
  addScore(sim, SCORE_TIME_BONUS * Math.floor(Math.max(0, sim.timer)), events);
  if (sim.fishBay === bay) {
    addScore(sim, SCORE_BONUS_CATCH, events);
    takeFish(sim);
  }

  sim.critter.present = false;
  sim.bears = [];
  emptySlots(sim);

  if (sim.bays.every((filled) => filled)) {
    clearLevel(sim, events);
    return;
  }
  sim.phase = "crossing";
  sim.phaseTimer = BAYFILL_PAUSE;
}

/** The level cleared: the bonus is paid, and the run moves on or is won. */
export function clearLevel(sim: Sim, events: TickEvents): void {
  addScore(sim, SCORE_LEVEL * sim.level, events);

  if (sim.level >= TOTAL_LEVELS) {
    addScore(sim, SCORE_VICTORY_LIFE * sim.lives, events);
    goTo(sim, "victory");
    sim.phase = "crossing";
    sim.phaseTimer = 0;
    events.cues.add(CUES.victory);
    return;
  }

  sim.phase = "clearing";
  sim.phaseTimer = CLEAR_PAUSE;
  events.cues.add(CUES.levelClear);
}

/** What happens when the hold the current phase is on expires. */
export function endHold(sim: Sim): void {
  if (sim.phase === "dying") {
    if (sim.lives <= 0) {
      goTo(sim, "gameover");
      sim.phase = "crossing";
      sim.phaseTimer = 0;
      return;
    }
    freshCrossing(sim);
    return;
  }
  if (sim.phase === "clearing") {
    sim.level += 1;
    sim.reachedLevel = Math.max(sim.reachedLevel, sim.level);
    openBays(sim);
    layOutStrait(sim);
    freshCrossing(sim);
    return;
  }
  // The hold after a bay was filled: the next crossing of the same level.
  freshCrossing(sim);
}
