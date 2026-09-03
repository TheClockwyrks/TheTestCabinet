// Carom — the menus' layout: where each item is drawn, and the hit region a
// pointer or a finger selects it from.
//
// specs/ui.md leaves the layout to the build and then requires the build to
// REPORT it: `menuItemRect(index)` on the debug surface returns the region of an
// item on the menu the current screen shows, in logical units. So the layout has
// to be one fact, read by the renderer and by that reading alike — a menu drawn
// from one set of figures and reported from another would put the hit region
// somewhere the player cannot see.
//
// That fact is this module. Each screen that shows a menu has a `MenuLayout`
// here; `src/render.ts` draws from it, `src/pointer.ts` hit-tests against it, and
// `src/debug.ts` reports it. It is pure geometry over constants — no canvas, no
// text measurement — so a hit region is the same before the first frame is drawn
// as after, and the game can resolve a pointer inside `update`, where no drawing
// context exists.
//
// The regions are fixed-width bars centered on the menu's column, tall enough to
// take a fingertip and separated by a gap, so no two items overlap and a press
// that lands between them lands on neither.

import {
  FIELD_CX,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import { HOWTO_ITEMS } from "./theme";
import type { Screen } from "./game";

/** A hit region in logical units: `x`/`y` its top-left corner, `w`/`h` its size. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One menu: its items, where they are drawn, and how each is hit-tested. */
export interface MenuLayout {
  /** The item copy, in order. */
  readonly items: readonly string[];
  /** The column every item is centered on. */
  readonly centerX: number;
  /** The center y of item 0. */
  readonly startY: number;
  /** The vertical distance between two consecutive items' centers. */
  readonly spacing: number;
  /** The item type size, in logical units. */
  readonly itemSize: number;
  /** The letter spacing the items are drawn with. */
  readonly letterSpacing: number;
  /** The hit region's width, centered on `centerX`. */
  readonly hitW: number;
  /** The hit region's height, centered on the item's own center y. */
  readonly hitH: number;
  /** The color the selection markers are drawn in. */
  readonly accent: "p1" | "winner";
}

/** The height of every hit region: a comfortable fingertip inside the spacing. */
const HIT_H = 46;

const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  startY: 430,
  spacing: 52,
  itemSize: 30,
  letterSpacing: 10,
  hitW: 520,
  hitH: HIT_H,
  accent: "p1",
};

const HOWTO_MENU: MenuLayout = {
  items: HOWTO_ITEMS,
  centerX: FIELD_CX,
  startY: FIELD_H - 44,
  spacing: 52,
  itemSize: 24,
  letterSpacing: 8,
  hitW: 360,
  hitH: HIT_H,
  accent: "p1",
};

/** The pause panel is 520 wide and centered, so its menu sits inside it. */
const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  startY: 360,
  spacing: 52,
  itemSize: 26,
  letterSpacing: 6,
  hitW: 440,
  hitH: HIT_H,
  accent: "p1",
};

/** The match-over panel is 560 wide and centered, and its menu sits inside it. */
const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  startY: 418,
  spacing: 52,
  itemSize: 26,
  letterSpacing: 6,
  hitW: 440,
  hitH: HIT_H,
  accent: "winner",
};

/**
 * The menu the screen shows, or `null` on `countdown` and `playing`, which show
 * none.
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
    default:
      return null;
  }
}

/** The center y item `index` is drawn at. */
export function itemCenterY(layout: MenuLayout, index: number): number {
  return layout.startY + index * layout.spacing;
}

/** The hit region of item `index` in `layout`, or `null` when it has no such item. */
export function layoutItemRect(
  layout: MenuLayout,
  index: number,
): MenuRect | null {
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  return {
    x: layout.centerX - layout.hitW / 2,
    y: itemCenterY(layout, index) - layout.hitH / 2,
    w: layout.hitW,
    h: layout.hitH,
  };
}

/**
 * The hit region of item `index` on the menu `screen` shows, in logical units.
 *
 * `null` on `countdown` and `playing`, which show no menu, and when `index`
 * names no item of the menu that screen shows (specs/instrumentation.md).
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = menuFor(screen);
  return layout === null ? null : layoutItemRect(layout, index);
}

/** Whether a logical point is inside a region, edges included. */
export function inRect(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The item of `screen`'s menu the logical point `(x, y)` is inside, or `-1` when
 * it is inside none — which a point in a letterbox bar, outside the field
 * entirely, always is.
 */
export function menuItemAt(screen: Screen, x: number, y: number): number {
  const layout = menuFor(screen);
  if (layout === null) return -1;
  for (let index = 0; index < layout.items.length; index++) {
    const rect = layoutItemRect(layout, index);
    if (rect !== null && inRect(rect, x, y)) return index;
  }
  return -1;
}
