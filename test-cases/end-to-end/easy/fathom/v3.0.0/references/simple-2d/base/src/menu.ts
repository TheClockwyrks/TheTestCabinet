// Fathom — where this build draws each menu item, and what lies under a point.
//
// `specs/ui.md` leaves a menu's layout to the build and then requires the build
// to REPORT it, through the `menuItemRect` reading `specs/instrumentation.md`
// fixes, so that a pointer and a finger can be aimed at the items wherever they
// were drawn. That makes the geometry one thing several modules read rather than
// a number the renderer keeps to itself: `src/render.ts` draws each item at the
// baseline this file gives it, `src/debug.ts` answers `menuItemRect` from the
// same table, and `src/game.ts` asks what a pointer sample landed on.
//
// The regions are laid out so the drawn text sits INSIDE its own region — the
// property `menuItemRect` is graded on — and so two regions of one menu never
// meet: every menu's spacing here is wider than one region is tall.

import {
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./state";

/** A rectangle in logical units: its top-left corner, and its size. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where a menu's first item sits, and how far apart its items are stacked. */
interface Stack {
  /** The text baseline of item `0`, in logical units. */
  readonly top: number;
  /** The distance between one item's baseline and the next's. */
  readonly gap: number;
}

/**
 * Each menu's items and its stack. The four screens absent from this table show
 * no menu (`specs/state.md`), which is what makes `menuItemRect` `null` there.
 */
const MENUS: Partial<
  Record<Screen, { items: readonly string[]; stack: Stack }>
> = {
  title: { items: TITLE_ITEMS, stack: { top: 420, gap: 58 } },
  paused: { items: PAUSE_ITEMS, stack: { top: STAGE_H / 2 + 16, gap: 48 } },
  gameover: {
    items: GAMEOVER_ITEMS,
    stack: { top: STAGE_H / 2 + 68, gap: 48 },
  },
};

/** How wide an item's region is: enough for `QUIT TO MENU` set at 28px. */
const ITEM_W = 420;

/** How tall it is, which is under the closest stack's `48` unit spacing. */
const ITEM_H = 40;

/** How far the region's top edge sits above the item's own text baseline. */
const ABOVE_BASELINE = 30;

/** The items the menu `screen` shows, empty on a screen that shows none. */
export function menuItems(screen: Screen): readonly string[] {
  return MENUS[screen]?.items ?? [];
}

/** The baseline item `index` of `screen`'s menu is drawn on. */
export function itemBaseline(screen: Screen, index: number): number {
  const menu = MENUS[screen];
  if (menu === undefined) return 0;
  return menu.stack.top + index * menu.stack.gap;
}

/**
 * The hit region of item `index` of the menu `screen` shows, or `null` where
 * that screen shows no menu or holds no such item.
 *
 * The region is centered on the same x the item's text is centered on and
 * straddles its baseline, so the point the text was drawn at lies inside it.
 */
export function itemRect(screen: Screen, index: number): Rect | null {
  const menu = MENUS[screen];
  if (menu === undefined) return null;
  if (!Number.isInteger(index) || index < 0 || index >= menu.items.length) {
    return null;
  }
  return {
    x: STAGE_W / 2 - ITEM_W / 2,
    y: itemBaseline(screen, index) - ABOVE_BASELINE,
    w: ITEM_W,
    h: ITEM_H,
  };
}

/** Whether `(x, y)` lies inside `rect`, edges included. */
function inside(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The item of `screen`'s menu the logical point `(x, y)` lies on, or `null`
 * where it lies on none of them.
 *
 * This is the one place a pointer position becomes a menu item, so what the
 * surface reports and what a click acts on cannot drift apart.
 */
export function itemAt(screen: Screen, x: number, y: number): number | null {
  const items = menuItems(screen);
  for (let index = 0; index < items.length; index += 1) {
    const rect = itemRect(screen, index);
    if (rect !== null && inside(rect, x, y)) return index;
  }
  return null;
}
