// Fathom — the run: the screens, the dive, and what a depth scales.
//
// The framework's states are live objects, so every transition here MUTATES the
// `FathomState` it is handed — the world's one instance — writing the fields it
// changes in place and leaving the rest alone. Each transition is shared by the
// menus in `src/controller.ts`, the rules in `src/sim.ts` and the debug surface
// in `src/debug.ts`, so a screen reached from the title menu and the same screen
// posed from code are one code path (`specs/instrumentation.md`).

import {
  DRIFTER_INTERVAL,
  GRID_COLS,
  GRID_ROWS,
  SCORE_CLEAR,
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  START_LIVES,
} from "./constants";
import { buildRoster, denSlots } from "./creatures";
import type { Cell } from "./grid";
import { cellIndex } from "./grid";
import { TRENCH, TRENCH_START } from "./layout";
import { restAt } from "./movement";
import { Rng } from "./rng";
import type { FathomState, Screen } from "./game";

/**
 * How long the dive countdown holds before play begins, and how long the
 * cleared interstitial holds before the descent. `specs/ui.md` fixes both
 * between `1 s` and `3 s`; where in that window they sit is this build's.
 */
export const COUNTDOWN_TIME = 2.1;
export const CLEARED_TIME = 1.6;

/** How many numbers the dive countdown steps through. */
export const COUNTDOWN_STEPS = 3;

/**
 * `E`, the sonar pulse's path range at a depth: one tile shorter per depth
 * below its base, down to its floor (`specs/progression.md`).
 */
export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/** Puts every predator back on a den tile, unreleased. */
export function denPredators(state: FathomState): void {
  const slots = denSlots(state.maze);
  state.predators.forEach((predator, index) => {
    predator.returnToDen(slots[index % slots.length]);
  });
}

/**
 * Grants the release its turn has come to. A predator added outside a roster
 * carries no slot, so the schedule passes it by however long the run lasts.
 */
export function applyReleaseSchedule(state: FathomState): void {
  for (const predator of state.predators) {
    if (predator.released || predator.releaseAt === null) continue;
    if (state.playTime >= predator.releaseAt) predator.released = true;
  }
}

/** A plankton on every corridor tile, which is the den and its gate excluded. */
export function seedPlankton(state: FathomState): void {
  state.plankton = new Array<boolean>(GRID_COLS * GRID_ROWS).fill(false);
  let remaining = 0;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (!state.maze.isCorridor(tx, ty)) continue;
      state.plankton[cellIndex(tx, ty)] = true;
      remaining += 1;
    }
  }
  state.planktonRemaining = remaining;
}

/**
 * The arrangement an attempt starts from (`specs/progression.md`): the forager
 * at rest on its start tile at brightness `0`, every predator back in the den
 * unreleased with the schedule armed afresh, no drifters and the cadence
 * restarted, no wavefronts and no ink, and both cooldowns ready. The plankton
 * already eaten stay eaten and the fog carries across.
 */
export function resetAttempt(state: FathomState): void {
  restAt(state.forager, state.maze.start);
  state.forager.facing = "up";
  state.forager.brightness = 0;
  state.forager.hold = 0;
  state.desired = null;
  state.heldDirs = [];

  state.predators = buildRoster(state.depth);
  denPredators(state);
  state.drifters = [];
  state.pulses = [];
  state.inkClouds = [];

  state.sonarCooldown = 0;
  state.inkCooldown = 0;
  state.drifterTimer = DRIFTER_INTERVAL;
  state.playTime = 0;
}

/** A maze laid out afresh: full plankton, fog fully unrevealed, all in place. */
export function freshMaze(state: FathomState): void {
  seedPlankton(state);
  state.fog.reset();
  resetAttempt(state);
}

/** Lays this build's trench out and puts a fresh maze on it. */
export function layoutTrench(state: FathomState): void {
  state.maze.load(TRENCH, TRENCH_START);
  freshMaze(state);
}

/**
 * Poses a layout over the maze (`specs/instrumentation.md`). The layout is the
 * whole of what it sets: the plankton, the fog, the roster, every body, the
 * cooldowns, the score, the lives, the depth and the screen are all left
 * exactly as they stand. The plankton the new layout walls into rock go with
 * the corridor they stood on, because a plankton stands on a corridor tile and
 * `planktonRemaining` counts the ones that stand.
 */
export function loadLayout(state: FathomState, rows: readonly string[]): void {
  state.maze.load(rows);
  let remaining = 0;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const key = cellIndex(tx, ty);
      if (!state.plankton[key]) continue;
      if (state.maze.isCorridor(tx, ty)) remaining += 1;
      else state.plankton[key] = false;
    }
  }
  state.planktonRemaining = remaining;
}

/** The dive countdown, held over the maze before control resumes. */
export function startCountdown(state: FathomState): void {
  openMenu(state, "countdown");
  state.countdown = COUNTDOWN_TIME;
}

/**
 * Arrive at `screen`, with the item that screen opens on selected.
 *
 * The pause menu and the game-over menu open on their first item; the title
 * opens on the entry `titleIndex` remembers (`specs/ui.md`). A gesture half-made
 * on the menu being left cannot carry across.
 */
export function openMenu(state: FathomState, screen: Screen): void {
  state.screen = screen;
  state.menuIndex = screen === "title" ? state.titleIndex : 0;
  state.pressedItem = null;
}

/**
 * A dive begun, which `DIVE`, `RESTART` and `PLAY AGAIN` all do the same way
 * (`specs/ui.md`): the score, the lives and the depth back to their opening
 * values, the maze laid out afresh, and the countdown running.
 */
export function beginDive(state: FathomState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.depth = 1;
  layoutTrench(state);
  startCountdown(state);
}

/**
 * The countdown ending. The release schedule's clock starts here, so release
 * time `0` is the moment `screen` becomes `"playing"` (`specs/predators.md`).
 */
export function beginPlay(state: FathomState): void {
  state.screen = "playing";
  state.countdown = 0;
  state.playTime = 0;
  applyReleaseSchedule(state);
}

/**
 * Back to the title, with the run's figures back where a dive begins from.
 *
 * `titleIndex` is the exception `specs/ui.md` names: it keeps its value across
 * the return, and the selection lands on the entry it holds, so the title comes
 * back on the item the player left it by.
 */
export function toTitle(state: FathomState): void {
  openMenu(state, "title");
  state.score = 0;
  state.lives = START_LIVES;
  state.depth = 1;
  layoutTrench(state);
}

/**
 * Contact with a predator. While a life remains in reserve the maze is set up
 * for another attempt and the countdown runs again; with none the run ends.
 */
export function loseLife(state: FathomState): void {
  if (state.lives === 0) {
    openMenu(state, "gameover");
    return;
  }
  state.lives -= 1;
  resetAttempt(state);
  startCountdown(state);
}

/** The forager eating the plankton that leaves none behind. */
export function clearMaze(state: FathomState): void {
  state.score += SCORE_CLEAR;
  state.screen = "cleared";
  state.clearedTimer = CLEARED_TIME;
}

/** The descent to the next maze, which opens on the dive countdown. */
export function descend(state: FathomState): void {
  state.depth += 1;
  layoutTrench(state);
  startCountdown(state);
}

/**
 * Every declared field back at its title-screen value, with the generator
 * reseeded (`specs/state.md`). `muted` is deliberately left as it stands:
 * muting is a player preference the runtime owns rather than a value a dive
 * opens with.
 */
export function resetState(state: FathomState, seed: number): void {
  state.rng = new Rng(seed);
  state.simTime = 0;
  state.accumulator = 0;
  state.countdown = 0;
  state.clearedTimer = 0;
  toTitle(state);
}

/** Where a drifter is admitted from: the corridor outside the den gate. */
export function drifterEntry(state: FathomState): Cell | null {
  const gate = state.maze.gate;
  if (gate === null) return null;
  const above: Cell = { tx: gate.tx, ty: gate.ty - 1 };
  if (state.maze.isCorridor(above.tx, above.ty)) return above;
  const [dir] = state.maze.exits(gate.tx, gate.ty, state.maze.openToForager);
  return dir === undefined ? null : state.maze.step(gate.tx, gate.ty, dir);
}
