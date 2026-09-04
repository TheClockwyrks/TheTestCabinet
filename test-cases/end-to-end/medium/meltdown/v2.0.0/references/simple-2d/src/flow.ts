// Meltdown — the screens, their menus, and where confirming a row leads.
//
// specs/screens.md fixes the eight screens, what each draws, and the one rule
// that governs every menu in the game: the highlight WRAPS at both ends. It
// also fixes what `back` does, in the precedence order specs/controls.md
// states.

import {
  DEFAULT_SEED,
  DIFFICULTIES,
  DIFFICULTY_ITEMS,
  DIFFICULTY_TABLE,
  ENDING_ITEMS,
  MODES,
  MODE_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  TITLE_ITEMS,
} from "./constants";
import { freshRun } from "./run";
import type { MeltdownState, Screen } from "./game";

/** The complete title-screen state, which is what a build opens on. */
export function createInitialState(): MeltdownState {
  return {
    screen: "title",
    phase: "opening",
    menuIndex: 0,

    mode: "containment",
    difficulty: "medium",
    money: DIFFICULTY_TABLE.medium.money,
    lives: START_LIVES,
    score: 0,
    wave: 1,

    buildTimer: 0,
    wavePending: 0,
    spawnClock: 0,
    speed: 1,

    towers: [],
    surge: [],

    selected: null,
    hoverShop: null,
    build: null,

    waveSpawning: true,
    pointer: { x: 0, y: 0, down: false },
    muted: false,

    nextId: 1,
    simTime: 0,
    rngState: DEFAULT_SEED,
  };
}

/**
 * Everything `reset` restores, with `muted` and `pointer` left exactly as they
 * stand because both mirror something the runtime owns
 * (specs/instrumentation.md).
 */
export function resetState(state: MeltdownState, seed: number): MeltdownState {
  const fresh = createInitialState();
  return {
    ...fresh,
    pointer: state.pointer,
    muted: state.muted,
    rngState: seed,
  };
}

/** How many rows the menu on `screen` has, `0` where the screen has none. */
export function menuLength(screen: Screen): number {
  switch (screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "modeselect":
      return MODE_ITEMS.length;
    case "difficultyselect":
      return DIFFICULTY_ITEMS.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "victory":
    case "gameover":
      return ENDING_ITEMS.length;
    case "howto":
    case "playing":
      return 0;
  }
}

/** The rows the menu on `screen` draws, top to bottom. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "modeselect":
      return MODE_ITEMS;
    case "difficultyselect":
      return DIFFICULTY_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "victory":
    case "gameover":
      return ENDING_ITEMS;
    case "howto":
    case "playing":
      return [];
  }
}

/**
 * Move the highlight, wrapping at both ends: down from the last row highlights
 * the first, and up from the first highlights the last.
 */
export function moveMenu(state: MeltdownState, delta: number): MeltdownState {
  const count = menuLength(state.screen);
  if (count <= 0) return state;
  const index = (((state.menuIndex + delta) % count) + count) % count;
  if (index === state.menuIndex) return state;
  return { ...state, menuIndex: index };
}

/** Put the highlight on one row outright, as a press on it does. */
export function highlight(state: MeltdownState, index: number): MeltdownState {
  const count = menuLength(state.screen);
  if (count <= 0 || index < 0 || index >= count) return state;
  return { ...state, menuIndex: index };
}

/** The title screen, which is where the game starts. */
export function toTitle(state: MeltdownState): MeltdownState {
  return { ...state, screen: "title", menuIndex: 0 };
}

/** Take the highlighted row of the current screen's menu. */
export function confirmMenu(state: MeltdownState): MeltdownState {
  switch (state.screen) {
    case "title":
      return state.menuIndex === 0
        ? { ...state, screen: "modeselect", menuIndex: 0 }
        : { ...state, screen: "howto", menuIndex: 0 };
    case "modeselect": {
      const mode = MODES[state.menuIndex];
      if (mode === "containment") {
        return { ...state, screen: "difficultyselect", menuIndex: 0 };
      }
      return freshRun(state, mode, state.difficulty);
    }
    case "difficultyselect":
      return freshRun(state, "containment", DIFFICULTIES[state.menuIndex]);
    case "paused":
      if (state.menuIndex === 0) return { ...state, screen: "playing" };
      if (state.menuIndex === 1) {
        return freshRun(state, state.mode, state.difficulty);
      }
      return toTitle(state);
    case "victory":
    case "gameover":
      return state.menuIndex === 0
        ? freshRun(state, state.mode, state.difficulty)
        : toTitle(state);
    case "howto":
    case "playing":
      return state;
  }
}

/**
 * `back`, in its stated precedence: cancel a held placement, else deselect,
 * else pause from live play, else leave the current screen.
 */
export function back(state: MeltdownState): MeltdownState {
  if (state.build !== null) return { ...state, build: null };
  if (state.selected !== null) return { ...state, selected: null };
  switch (state.screen) {
    case "playing":
      return { ...state, screen: "paused", menuIndex: 0 };
    case "paused":
      return { ...state, screen: "playing" };
    case "modeselect":
    case "howto":
      return toTitle(state);
    case "difficultyselect":
      return { ...state, screen: "modeselect", menuIndex: 0 };
    case "victory":
    case "gameover":
      return toTitle(state);
    case "title":
      return state;
  }
}

/** Pause from live play, and resume from the pause screen. */
export function togglePause(state: MeltdownState): MeltdownState {
  if (state.screen === "playing") {
    return { ...state, screen: "paused", menuIndex: 0 };
  }
  if (state.screen === "paused") return { ...state, screen: "playing" };
  return state;
}
