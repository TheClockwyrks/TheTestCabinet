// Meltdown — the screens, the menus, and what starts a run.
//
// The game is on exactly one of eight screens (specs/screens.md), and every one
// of them but `playing` is a vertical list of rows whose highlight WRAPS at
// both ends. `menuRows` is the single place the length of each list is decided,
// so a wrap, a pointer tap on a row, and a confirm all agree about how many
// rows there are.
//
// Starting a run is one function, reached from four places: confirming a
// difficulty, confirming a mode that has none, RESTART on the pause menu, and
// PLAY AGAIN on either end screen. Each of those replays the same mode and
// difficulty pair the run just used, which is why the pair is passed in rather
// than read from wherever the caller stood.

import {
  DIFFICULTIES,
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  HOWTO_ITEMS,
  MODES,
  MODE_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  type DifficultyName,
  type ModeName,
} from "./constants";
import { refreshRoutes } from "./build";
import { figuresOf } from "./waves";
import type { MeltdownState, Screen } from "./game";

/** How many rows the menu on this screen has; `0` where there is no menu. */
export function menuRows(screen: Screen): number {
  switch (screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "modeselect":
      return MODE_ITEMS.length;
    case "difficultyselect":
      return DIFFICULTY_ITEMS.length;
    case "howto":
      return HOWTO_ITEMS.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "victory":
    case "gameover":
      return ENDING_ITEMS.length;
    case "playing":
      return 0;
  }
}

/**
 * Move the highlight, wrapping at both ends: down from the last row highlights
 * the first, up from the first highlights the last, on every menu in the game.
 * Returns whether the highlight moved, which is the one thing the menu cue
 * answers.
 */
export function moveMenu(state: MeltdownState, delta: number): boolean {
  const rows = menuRows(state.screen);
  if (rows <= 0) return false;
  const next = (((state.menuIndex + delta) % rows) + rows) % rows;
  if (next === state.menuIndex) return false;
  state.menuIndex = next;
  return true;
}

/** Every declared field back at the values a fresh run of this pair opens on. */
export function startRun(
  state: MeltdownState,
  mode: ModeName,
  difficulty: DifficultyName,
): void {
  state.mode = mode;
  state.difficulty = difficulty;
  const figures = figuresOf(state);
  state.screen = "playing";
  state.phase = "opening";
  state.menuIndex = 0;
  state.money = figures.startMoney;
  state.lives = figures.startLives;
  state.score = 0;
  state.wave = 1;
  state.buildTimer = 0;
  state.wavePending = 0;
  state.spawnClock = 0;
  state.speed = 1;
  state.towers = [];
  state.surge = [];
  state.selected = null;
  state.hoverShop = null;
  state.build = null;
  state.nextId = 1;
  refreshRoutes(state);
}

/**
 * Every declared field back at its title-screen value. `muted` and `pointer`
 * are left exactly as they stand: both mirror something the runtime owns, and a
 * reset restores the game rather than the runtime beneath it.
 */
export function resetState(state: MeltdownState): void {
  state.mode = "containment";
  state.difficulty = "medium";
  const figures = figuresOf(state);
  state.screen = "title";
  state.phase = "opening";
  state.menuIndex = 0;
  state.money = figures.startMoney;
  state.lives = figures.startLives;
  state.score = 0;
  state.wave = 1;
  state.buildTimer = 0;
  state.wavePending = 0;
  state.spawnClock = 0;
  state.speed = 1;
  state.towers = [];
  state.surge = [];
  state.selected = null;
  state.hoverShop = null;
  state.build = null;
  state.waveSpawning = true;
  state.spawnVent = null;
  state.nextId = 1;
  state.simTime = 0;
  refreshRoutes(state);
}

/**
 * The row the title is highlighted on when the how-to screen is left, which
 * `specs/screens.md` fixes at `HOW TO PLAY`: returning to a screen highlights
 * the row that led away from it.
 */
const TITLE_HOWTO_ROW = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Take the highlighted row of the menu the current screen shows. */
export function confirmMenu(state: MeltdownState): void {
  const index = state.menuIndex;
  switch (state.screen) {
    case "title":
      state.screen = index === 0 ? "modeselect" : "howto";
      state.menuIndex = 0;
      return;
    case "modeselect": {
      // The last row is `BACK`, which names no mode and starts nothing.
      if (index >= MODES.length) {
        leaveScreen(state);
        return;
      }
      const mode: ModeName = MODES[index] ?? "containment";
      if (mode === "containment") {
        state.screen = "difficultyselect";
        state.menuIndex = 0;
      } else {
        startRun(state, mode, state.difficulty);
      }
      return;
    }
    case "difficultyselect":
      // The last row is `BACK`, which names no difficulty and starts nothing.
      if (index >= DIFFICULTIES.length) {
        leaveScreen(state);
        return;
      }
      startRun(state, "containment", DIFFICULTIES[index] ?? "medium");
      return;
    case "paused":
      if (index === 0) state.screen = "playing";
      else if (index === 1) startRun(state, state.mode, state.difficulty);
      else {
        state.screen = "title";
        state.menuIndex = 0;
      }
      return;
    case "victory":
    case "gameover":
      if (index === 0) startRun(state, state.mode, state.difficulty);
      else {
        state.screen = "title";
        state.menuIndex = 0;
      }
      return;
    case "howto":
      leaveScreen(state);
      return;
    case "playing":
      return;
  }
}

/**
 * Leave the current screen: the fourth and last case of the `back` precedence
 * rule, reached once nothing is armed and nothing is selected
 * (specs/controls.md).
 */
export function leaveScreen(state: MeltdownState): void {
  switch (state.screen) {
    case "title":
      return;
    case "modeselect":
      state.screen = "title";
      state.menuIndex = 0;
      return;
    case "howto":
      state.screen = "title";
      state.menuIndex = TITLE_HOWTO_ROW;
      return;
    case "difficultyselect":
      state.screen = "modeselect";
      state.menuIndex = 0;
      return;
    case "playing":
      state.screen = "paused";
      state.menuIndex = 0;
      return;
    case "paused":
      state.screen = "playing";
      state.menuIndex = 0;
      return;
    case "victory":
    case "gameover":
      state.screen = "title";
      state.menuIndex = 0;
      return;
  }
}

/** The `pause` action: into the pause screen from live play, and back out. */
export function togglePause(state: MeltdownState): boolean {
  if (state.screen === "playing") {
    state.screen = "paused";
    state.menuIndex = 0;
    return true;
  }
  if (state.screen === "paused") {
    state.screen = "playing";
    state.menuIndex = 0;
    return true;
  }
  return false;
}
