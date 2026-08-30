// Meltdown — the menus, and where confirming a row leads (specs/screens.md).
//
// Every menu is a vertical list with one row highlighted, the highlight WRAPS at
// both ends, and every row is a pointer target as well as a keyboard one. Both
// facts live here so the renderer, the keyboard and the pointer all read one
// layout: the rectangles this file returns are the rectangles the renderer draws
// and the rectangles a press is tested against.

import {
  CUES,
  DIFFICULTIES,
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  MODES,
  MODE_ITEMS,
  PAUSE_ITEMS,
  REACTOR_W,
  TITLE_ITEMS,
} from "./constants";
import type { CueSink } from "./build";
import { startRun, type MeltdownState } from "./state";
import type { Rect, Screen } from "./types";

/** The how-to screen's one row, which is this build's own way back from it. */
export const HOWTO_ITEMS: readonly string[] = ["BACK"];

/** A menu row's box, and the pitch between two of them. */
export const MENU_ROW = { w: 380, h: 44, pitch: 52 } as const;

/** Where each screen's list of rows starts, in logical stage units. */
const MENU_TOP: Partial<Record<Screen, number>> = {
  title: 392,
  modeselect: 232,
  difficultyselect: 300,
  howto: 632,
  paused: 300,
  victory: 452,
  gameover: 452,
};

/** The rows the current screen's menu shows; empty where it shows none. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "modeselect":
      return MODE_ITEMS;
    case "difficultyselect":
      return DIFFICULTY_ITEMS;
    case "howto":
      return HOWTO_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "victory":
    case "gameover":
      return ENDING_ITEMS;
    default:
      return [];
  }
}

/** Where each row of the current screen's menu is drawn. */
export function menuRects(screen: Screen): Rect[] {
  const top = MENU_TOP[screen];
  const items = menuItems(screen);
  if (top === undefined || items.length === 0) return [];
  return items.map((_item, index) => ({
    x: (REACTOR_W - MENU_ROW.w) / 2,
    y: top + index * MENU_ROW.pitch,
    w: MENU_ROW.w,
    h: MENU_ROW.h,
  }));
}

/** The highlighted row, folded into the menu's range for drawing and reading. */
export function highlighted(state: MeltdownState): number {
  const count = menuItems(state.screen).length;
  if (count === 0) return 0;
  return ((state.menuIndex % count) + count) % count;
}

/**
 * Move the highlight by `delta`, wrapping at both ends: down from the last row
 * highlights the first, up from the first highlights the last.
 */
export function moveMenu(
  state: MeltdownState,
  delta: number,
  cue: CueSink,
): void {
  const count = menuItems(state.screen).length;
  if (count === 0) return;
  state.menuIndex = (((state.menuIndex + delta) % count) + count) % count;
  cue(CUES.menu);
}

/** Take the highlighted row of the current screen's menu. */
export function confirmMenu(state: MeltdownState): void {
  const index = highlighted(state);
  switch (state.screen) {
    case "title":
      state.screen = index === 0 ? "modeselect" : "howto";
      state.menuIndex = 0;
      return;
    case "modeselect": {
      const mode = MODES[index];
      state.mode = mode;
      if (mode === "containment") {
        state.screen = "difficultyselect";
        state.menuIndex = 0;
        return;
      }
      startRun(state);
      return;
    }
    case "difficultyselect":
      state.mode = "containment";
      state.difficulty = DIFFICULTIES[index];
      startRun(state);
      return;
    case "howto":
      state.screen = "title";
      state.menuIndex = 0;
      return;
    case "paused":
      if (index === 0) {
        state.screen = "playing";
        return;
      }
      if (index === 1) {
        startRun(state);
        return;
      }
      state.screen = "title";
      state.menuIndex = 0;
      return;
    case "victory":
    case "gameover":
      if (index === 0) {
        startRun(state);
        return;
      }
      state.screen = "title";
      state.menuIndex = 0;
      return;
    default:
      // `playing` shows no menu, so there is no row to take.
      return;
  }
}

/** Leave the current screen, which is what `back` does once nothing is held. */
export function backFromScreen(state: MeltdownState): void {
  switch (state.screen) {
    case "modeselect":
    case "howto":
      state.screen = "title";
      state.menuIndex = 0;
      return;
    case "difficultyselect":
      state.screen = "modeselect";
      state.menuIndex = 0;
      return;
    case "paused":
      state.screen = "playing";
      return;
    case "victory":
    case "gameover":
      state.screen = "title";
      state.menuIndex = 0;
      return;
    default:
      // The title is where the game starts, and there is no screen behind it.
      return;
  }
}
