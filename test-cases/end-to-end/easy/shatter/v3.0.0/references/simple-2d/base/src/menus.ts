// Shatter — where each menu's entries sit on the field (`specs/ui.md`).
//
// ONE TABLE, TWO READERS. `render.ts` draws each entry and its highlight band
// from the layout below, and `debug.ts` reports the same bands through
// `menuItemRect` (`specs/instrumentation.md`). Keeping them on one table is what
// makes the region a pointer is tested against the region a player sees: a menu
// moved here moves for the eye, for the mouse and for the report together.
//
// NONE OF IT IS SPECIFIED. `specs/ui.md` fixes each menu's entries and their
// order and leaves the layout to the build, so every figure here is this build's
// own choice.

import { FIELD_W } from "./constants";
import { menuItems } from "./flow";
import type { Screen } from "./game";

/** A rectangle in logical field units, with `(x, y)` its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one screen's menu is laid out, in logical units. */
interface MenuLayout {
  /** The first entry's baseline. */
  readonly firstY: number;
  /** From one entry's baseline to the next. */
  readonly gap: number;
  /** The type size the entries are set at. */
  readonly size: number;
}

/**
 * How wide an entry's band is, in logical units.
 *
 * Wide enough to hold the longest entry any menu shows (`QUIT TO MENU`) with
 * room either side, so a player aiming at the words lands inside the region.
 */
const ENTRY_W = 440;

/** How tall a band is, as a multiple of the type size, and where its top sits. */
const BAND_HEIGHT = 1.6;
const BAND_ABOVE = 0.8;

/** The menus, by the screen that shows them. */
const LAYOUTS: Readonly<Record<string, MenuLayout>> = {
  title: { firstY: 420, gap: 68, size: 36 },
  paused: { firstY: 330, gap: 68, size: 36 },
  gameover: { firstY: 440, gap: 68, size: 36 },
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
  const items = menuItems(screen);
  if (layout === null || items === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return null;
  }
  const baseline = layout.firstY + index * layout.gap;
  return {
    x: FIELD_W / 2 - ENTRY_W / 2,
    y: baseline - layout.size * BAND_ABOVE,
    w: ENTRY_W,
    h: layout.size * BAND_HEIGHT,
  };
}

/**
 * The entry whose band holds `(x, y)`, or `-1` for a point outside them all.
 *
 * `-1` rather than `null` because it is what a press remembers: a press that
 * came down on no entry is a press that can never confirm, and holding that as a
 * number keeps the comparison in `pointer.ts` a single equality.
 */
export function menuItemAt(screen: Screen, x: number, y: number): number {
  const items = menuItems(screen);
  if (items === null) return -1;
  for (let index = 0; index < items.length; index += 1) {
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
