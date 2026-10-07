// Cascade — the menus each screen carries (`specs/controls.md`).
//
// `specs/controls.md` makes the controls a screen carries that screen's menu,
// "in the order the table above gives them", and leaves WHERE each one sits to
// this build: "Each control occupies a rectangular hit region the build lays
// out." So this module owns the layout, and it is the one place that knows it —
// the renderer draws what it reports, the pointer hit-tests what it reports, and
// `menuItemRect` on the debug surface answers it straight.
//
// ACTIVATION IS ONE FUNCTION, whatever raised it. `specs/controls.md`: "The item
// every activation acts on is the item at `menuIndex`, whichever input raised
// it, and the effect is the one the keyboard table gives `menu-confirm` on that
// screen." A key, a mouse click and a finger tap therefore all end here.

import type { AudioPort } from "./audio-bus";
import { startNewGame } from "./board";
import {
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./constants";
import type { CascadeState } from "./state";
import type { Rect, Screen } from "./types";
import { pointInRect } from "./types";

/**
 * The hit regions of each screen's menu, in the order `specs/controls.md` gives
 * the screen's controls.
 *
 * `won` shows no menu, so it has none.
 */
const MENUS: Readonly<Record<Screen, readonly Rect[]>> = {
  title: [TITLE_NEW_GAME, TITLE_HOW_TO],
  howto: [HOWTO_BACK],
  playing: [HUD_NEW_GAME, HUD_MENU, HUD_SOUND],
  won: [],
};

/** The regions of the menu `screen` shows, in order. */
export function menuItems(screen: Screen): readonly Rect[] {
  return MENUS[screen];
}

/** The region of item `index` of that menu, or `null` when there is none. */
export function menuItemRect(screen: Screen, index: number): Rect | null {
  const items = MENUS[screen];
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return null;
  }
  return { ...items[index] };
}

/** The index of the item whose region holds a point, or `null`. */
export function itemAt(screen: Screen, x: number, y: number): number | null {
  const items = MENUS[screen];
  for (let index = 0; index < items.length; index += 1) {
    if (pointInRect(x, y, items[index])) return index;
  }
  return null;
}

/** Clamp a selection to the menu the screen shows, wrapping at both ends. */
export function wrapIndex(screen: Screen, index: number): number {
  const length = MENUS[screen].length;
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

/**
 * Activate the item at `menuIndex` on the current screen, as `specs/screens.md`
 * states for it.
 *
 * The title's two entries also record what they were: `specs/screens.md` has
 * `titleIndex` follow the entry last activated there, and both returns to the
 * title restore `menuIndex` from it.
 */
export function activateMenuItem(state: CascadeState, audio: AudioPort): void {
  const index = state.menuIndex;
  if (state.screen === "title") {
    if (index === 0) {
      state.titleIndex = 0;
      // Every deal that begins play selects the first HUD item.
      state.menuIndex = 0;
      startNewGame(state);
      return;
    }
    if (index === 1) {
      state.titleIndex = 1;
      state.screen = "howto";
      state.menuIndex = 0;
    }
    return;
  }
  if (state.screen === "howto") {
    returnToTitle(state);
    return;
  }
  if (state.screen !== "playing") return;
  if (index === 0) {
    state.menuIndex = 0;
    startNewGame(state);
    return;
  }
  if (index === 1) {
    returnToTitle(state);
    return;
  }
  if (index === 2) {
    audio.setMuted(!audio.muted());
    // Mirrored at once as well as in every update, so the bit the snapshot
    // reports is the bit the runtime holds the instant the control answered.
    state.muted = audio.muted();
  }
}

/**
 * Leave for the title, with the entry that led away from it selected.
 *
 * `specs/screens.md`: "`BACK` on the how-to screen and `MENU` on the HUD both
 * return to `title` with `menuIndex` set to `titleIndex`, the title entry last
 * activated."
 */
export function returnToTitle(state: CascadeState): void {
  state.screen = "title";
  state.menuIndex = wrapIndex("title", state.titleIndex);
}
