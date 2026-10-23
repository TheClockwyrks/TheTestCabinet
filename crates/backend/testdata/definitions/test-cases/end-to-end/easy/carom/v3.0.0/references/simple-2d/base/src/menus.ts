// Carom — the menus' layout, in logical units.
//
// specs/ui.md says each menu item occupies a rectangular hit region THE BUILD
// LAYS OUT, and specs/instrumentation.md says the build reports that region
// through `menuItemRect`. So the layout has to be a fact rather than a side
// effect of drawing: this module is that fact, and both `src/render.ts` (which
// draws the items) and `src/debug.ts` (which reports their regions) read it.
// There is one description of where a menu item is, so what a pointer selects
// and what the player sees cannot drift apart.
//
// A region is deliberately wider and taller than its glyphs, and narrower than
// the gap between two items, so a click anywhere along a row lands on it and no
// two regions overlap. Nothing here measures text: a hit region that depended on
// the canvas's font metrics could not be reported without a canvas.

import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";
import { HOWTO_ITEMS, MATCHOVER_PANEL, PAUSE_PANEL } from "./theme";

/**
 * A hit region in logical units: `x` and `y` its top-left corner, `w` and `h` its
 * size. This is the shape specs/instrumentation.md fixes for `menuItemRect`, and
 * it is deliberately not `constants.ts`'s corner-pair `Rect`.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one screen's menu sits, and how its items are spaced and sized. */
export interface MenuLayout {
  /** The items, in the order the screen shows them. */
  readonly items: readonly string[];
  /** The x every item is centered on. */
  readonly centerX: number;
  /** The center y of item `0`. */
  readonly firstY: number;
  /** The vertical distance between two items' centers. */
  readonly spacing: number;
  /** The item type size, in logical units. */
  readonly itemSize: number;
  /** The item letter spacing, in logical units. */
  readonly letterSpacing: number;
  /** The hit region's width. */
  readonly hitW: number;
  /** The hit region's height, kept under `spacing` so no two regions touch. */
  readonly hitH: number;
}

const ROW_SPACING = 52;
const HIT_HEIGHT = 44;

const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  firstY: 430,
  spacing: ROW_SPACING,
  itemSize: 30,
  letterSpacing: 10,
  hitW: 420,
  hitH: HIT_HEIGHT,
};

const HOWTO_MENU: MenuLayout = {
  items: HOWTO_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_H - 44,
  spacing: ROW_SPACING,
  itemSize: 22,
  letterSpacing: 8,
  hitW: 340,
  hitH: HIT_HEIGHT,
};

const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_CY - PAUSE_PANEL.h / 2 + 200,
  spacing: ROW_SPACING,
  itemSize: 26,
  letterSpacing: 6,
  hitW: 400,
  hitH: HIT_HEIGHT,
};

const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_CY - MATCHOVER_PANEL.h / 2 + 268,
  spacing: ROW_SPACING,
  itemSize: 26,
  letterSpacing: 6,
  hitW: 400,
  hitH: HIT_HEIGHT,
};

/**
 * The menu the screen shows, or `null` for the two screens that show none.
 *
 * `countdown` and `playing` are the live field, so they have no menu at all —
 * which is why `menuItemRect` reports `null` on them.
 */
export function menuFor(screen: Screen): MenuLayout | null {
  switch (screen) {
    case "title":
      return TITLE_MENU;
    case "howto":
      return HOWTO_MENU;
    case "paused":
      return PAUSE_MENU;
    case "matchover":
      return MATCHOVER_MENU;
    case "countdown":
    case "playing":
      return null;
  }
}

/** The center y of item `index`, which is where its text is drawn. */
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

/** Whether a point lies inside a region, its top and left edges included. */
export function inside(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** The item a point lands in, or `null` when it lands outside every region. */
export function itemAt(menu: MenuLayout, x: number, y: number): number | null {
  for (let index = 0; index < menu.items.length; index++) {
    const rect = itemRect(menu, index);
    if (rect && inside(rect, x, y)) return index;
  }
  return null;
}
