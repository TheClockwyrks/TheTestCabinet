// Cascade — the menus each screen carries (specs/controls.md).
//
// specs/controls.md makes the controls a screen carries that screen's menu, "in
// the order the table above gives them", and leaves WHERE each one sits to this
// build: "Each control occupies a rectangular hit region the build lays out." So
// this module owns the layout, and it is the one place that knows it — the
// screens draw what it reports, the input layer hit-tests what it reports, and
// `menuItemRect` on the debug surface answers it straight.

import type { Rect } from "./layout";
import type { Screen } from "./game";

/**
 * Where this build puts each control. `specs/controls.md` fixes no position —
 * "Each control occupies a rectangular hit region the build lays out" — so these
 * six are this build's own layout, and `menuItemRect` reports them.
 */
export const TITLE_NEW_GAME: Rect = { x: 480, y: 448, w: 320, h: 52 };
export const TITLE_HOW_TO: Rect = { x: 480, y: 516, w: 320, h: 52 };
export const HOWTO_BACK: Rect = { x: 480, y: 600, w: 320, h: 52 };
export const HUD_NEW_GAME: Rect = { x: 224, y: 680, w: 180, h: 36 };
export const HUD_MENU: Rect = { x: 420, y: 680, w: 120, h: 36 };
export const HUD_SOUND: Rect = { x: 556, y: 680, w: 120, h: 36 };

/** Whether a point lies inside a rectangle, half-open on the far edges. */
function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/**
 * The hit regions of each screen's menu, in the order specs/controls.md gives
 * the screen's controls. `won` shows no menu, so it has none.
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
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const items = MENUS[screen];
  for (let index = 0; index < items.length; index += 1) {
    if (contains(items[index], x, y)) return index;
  }
  return null;
}

/** Wrap a selection over the menu the screen shows. */
export function wrapMenuIndex(screen: Screen, index: number): number {
  const length = MENUS[screen].length;
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}
