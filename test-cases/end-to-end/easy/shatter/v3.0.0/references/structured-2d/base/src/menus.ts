// Shatter — where each menu's entries sit on the field (`specs/ui.md`).
//
// ONE TABLE, TWO READERS. `render.ts` paints each entry from the layout below,
// and `debug.ts` reports the same bands through `menuItemRect`
// (`specs/instrumentation.md`). Keeping them on one table is what makes the
// region a pointer is tested against the region a player sees: a menu moved here
// moves for the eye, for the mouse and for the report together.
//
// NONE OF IT IS SPECIFIED. `specs/ui.md` fixes each menu's entries and their
// order and leaves the layout to the build, so every figure here is this build's
// own choice.

import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import type { Screen } from "./game";

/** A rectangle in logical field units, with `(x, y)` its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one screen's menu is laid out, in logical units. */
export interface MenuLayout {
  /** The first entry's centre line. */
  readonly top: number;
  /** The entries the screen shows, in order. */
  readonly entries: readonly string[];
}

/** From one entry's centre line to the next, in logical units. */
export const MENU_STEP = 58;

/** Where an entry's glyphs start, and where its highlight mark is painted. */
export const MENU_TEXT_X = 540;
export const MENU_MARK_X = 496;

/**
 * The band an entry occupies, in logical units.
 *
 * It opens left of the highlight mark at `496`, so a player aiming at the mark is
 * aiming at the entry, and reaches far enough right to hold the longest entry any
 * menu shows. The height is comfortably inside the `58` from one entry to the
 * next, so no two bands can meet.
 */
const ENTRY_X = 470;
const ENTRY_W = 340;
const ENTRY_H = 46;

/** The menus, by the screen that shows them. */
const LAYOUTS: Readonly<Record<string, MenuLayout>> = {
  title: { top: 400, entries: TITLE_ITEMS },
  paused: { top: 330, entries: PAUSE_ITEMS },
  gameover: { top: 420, entries: GAMEOVER_ITEMS },
};

/** The layout of the menu `screen` shows, or `null` where it shows none. */
export function menuLayout(screen: Screen): MenuLayout | null {
  return LAYOUTS[screen] ?? null;
}

/**
 * The band entry `index` occupies, or `null` for a screen with no menu and for
 * an index naming no entry of the one it has.
 */
export function menuItemRect(screen: Screen, index: number): Rect | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= layout.entries.length) {
    return null;
  }
  return {
    x: ENTRY_X,
    y: layout.top + index * MENU_STEP - ENTRY_H / 2,
    w: ENTRY_W,
    h: ENTRY_H,
  };
}

/**
 * The entry whose band holds `(x, y)`, or `-1` for a point outside them all.
 *
 * `-1` rather than `null` because it is what a press remembers: a press that came
 * down on no entry can never confirm, and holding that as a number keeps the
 * comparison in `pointer.ts` a single equality.
 */
export function menuItemAt(screen: Screen, x: number, y: number): number {
  const layout = menuLayout(screen);
  if (layout === null) return -1;
  for (let index = 0; index < layout.entries.length; index += 1) {
    const rect = menuItemRect(screen, index);
    if (rect === null) continue;
    if (
      x >= rect.x &&
      x <= rect.x + rect.w &&
      y >= rect.y &&
      y <= rect.y + rect.h
    ) {
      return index;
    }
  }
  return -1;
}
