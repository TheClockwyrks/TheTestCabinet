// Shatter — where each menu's entries sit on the field (`specs/ui.md`).
//
// ONE TABLE, TWO READERS. `render.ts` draws each entry from the layout below,
// and `debug.ts` reports the same bands through `menuItemRect`
// (`specs/instrumentation.md`). Keeping them on one table is what makes the
// region a pointer is tested against the region a player sees: a menu moved here
// moves for the eye, for the mouse and for the report together.
//
// NONE OF IT IS SPECIFIED. `specs/ui.md` fixes each menu's entries and their
// order and leaves the layout to the build, so every figure here is this build's
// own choice.

import {
  FIELD_W,
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  type Screen,
} from "./constants";

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
  /** From one entry's centre to the next. */
  readonly step: number;
  /** The entries the screen shows, in order. */
  readonly entries: readonly string[];
}

/**
 * How wide an entry's band is, in logical units.
 *
 * It reaches past the caret drawn beside a highlighted entry, so a player aiming
 * at the caret is aiming at the entry, and holds the longest entry any menu
 * shows.
 */
const ENTRY_W = 400;

/** How tall a band is: comfortably inside the tightest step of the three menus. */
const ENTRY_H = 44;

/** The menus, by the screen that shows them. */
const LAYOUTS: Readonly<Record<string, MenuLayout>> = {
  title: { top: 420, step: 58, entries: TITLE_ITEMS },
  paused: { top: 350, step: 58, entries: PAUSE_ITEMS },
  gameover: { top: 470, step: 52, entries: GAMEOVER_ITEMS },
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
    x: FIELD_W / 2 - ENTRY_W / 2,
    y: layout.top + index * layout.step - ENTRY_H / 2,
    w: ENTRY_W,
    h: ENTRY_H,
  };
}

/**
 * The entry whose band holds `(x, y)`, or `-1` for a point outside them all.
 *
 * `-1` rather than `null` because it is what a press remembers: a press that came
 * down on no entry can never confirm, and holding that as a number keeps the
 * comparison in `game.ts` a single equality.
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
