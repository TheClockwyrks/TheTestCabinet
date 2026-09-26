// Wireworm — where each menu item sits, in logical stage units.
//
// `specs/ui.md` gives every menu screen a pointer and a finger as well as the
// keyboard, over a rectangular hit region THE BUILD lays out, and
// `specs/instrumentation.md` makes the build report that region through
// `menuItemRect`. So the layout has to be a fact of its own rather than a side
// effect of drawing: this module is that fact, and `src/render.ts` (which draws
// the items and the plate behind the highlighted one) and `src/debug.ts` (which
// reports their regions) both read it. There is one description of where a menu
// item is, so what a pointer selects and what the player sees cannot drift
// apart.
//
// A region is the plate the highlight is drawn on: wider and taller than the
// glyphs and shorter than the gap between two rows, so a click anywhere along a
// row lands on it and no two regions touch. Nothing here measures text, because
// a region that depended on the canvas's font metrics could not be reported
// without a canvas.

import { ENDING_ITEMS, PAUSE_ITEMS, STAGE_W, TITLE_ITEMS } from "./constants";
import type { Screen } from "./game";

/**
 * A hit region in logical stage units: `x` and `y` its top-left corner, `w` and
 * `h` its size. The shape `specs/instrumentation.md` fixes for `menuItemRect`.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one screen's menu sits, and how its rows are drawn and struck. */
export interface MenuLayout {
  /** The items, in the order the screen shows them. */
  readonly items: readonly string[];
  /** The x every item is centered on. */
  readonly centerX: number;
  /** The center y of item `0`, which is the line its text is drawn on. */
  readonly firstY: number;
  /** The vertical distance between two items' centers. */
  readonly spacing: number;
  /** The row's width. */
  readonly hitW: number;
  /** The row's height, kept under `spacing` so no two rows touch. */
  readonly hitH: number;
}

/** Every menu shares one row pitch, one width and one height. */
const ROW_SPACING = 46;
const ROW_W = 380;
const ROW_H = 44;

export const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: STAGE_W / 2,
  firstY: 420,
  spacing: ROW_SPACING,
  hitW: ROW_W,
  hitH: ROW_H,
};

export const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: STAGE_W / 2,
  firstY: 340,
  spacing: ROW_SPACING,
  hitW: ROW_W,
  hitH: ROW_H,
};

export const VICTORY_MENU: MenuLayout = {
  items: ENDING_ITEMS,
  centerX: STAGE_W / 2,
  firstY: 440,
  spacing: ROW_SPACING,
  hitW: ROW_W,
  hitH: ROW_H,
};

export const GAMEOVER_MENU: MenuLayout = {
  items: ENDING_ITEMS,
  centerX: STAGE_W / 2,
  firstY: 420,
  spacing: ROW_SPACING,
  hitW: ROW_W,
  hitH: ROW_H,
};

/**
 * The menu the screen shows, or `null` for the two screens that show none.
 *
 * `playing` is the live board and `howto` is a page answering to `back` alone
 * (`specs/ui.md`), which is why `menuItemRect` reports `null` on both.
 */
export function menuFor(screen: Screen): MenuLayout | null {
  switch (screen) {
    case "title":
      return TITLE_MENU;
    case "paused":
      return PAUSE_MENU;
    case "victory":
      return VICTORY_MENU;
    case "gameover":
      return GAMEOVER_MENU;
    case "howto":
    case "playing":
      return null;
  }
}

/** The center y of item `index`, which is the line its text is drawn on. */
export function itemCenterY(menu: MenuLayout, index: number): number {
  return menu.firstY + index * menu.spacing;
}

/** Whether `index` names one of this menu's items. */
export function isItem(menu: MenuLayout, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < menu.items.length;
}

/** The hit region of item `index`, or `null` when the menu has no such item. */
export function itemRect(menu: MenuLayout, index: number): MenuRect | null {
  if (!isItem(menu, index)) return null;
  return {
    x: menu.centerX - menu.hitW / 2,
    y: itemCenterY(menu, index) - menu.hitH / 2,
    w: menu.hitW,
    h: menu.hitH,
  };
}

/** Whether a point lies inside a region, its edges included. */
export function inside(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** The item a point lands in, or `null` when it lands outside every region. */
export function itemAt(menu: MenuLayout, x: number, y: number): number | null {
  for (let index = 0; index < menu.items.length; index += 1) {
    const rect = itemRect(menu, index);
    if (rect !== null && inside(rect, x, y)) return index;
  }
  return null;
}
