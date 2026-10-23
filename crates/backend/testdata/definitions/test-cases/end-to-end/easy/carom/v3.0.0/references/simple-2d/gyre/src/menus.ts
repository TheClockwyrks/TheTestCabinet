// Carom — the menus: what each menu screen shows, where each item is drawn, and
// which item a point lands on (specs/ui.md).
//
// The menus are driven by three inputs, and every one of them needs the SAME
// answer to "where is item i": the keyboard moves an index over the items, a
// pointer selects the item its position lands in, and `menuItemRect` on the debug
// surface reports that region to a caller. So the layout is declared once, here,
// as data — and `src/render.ts` draws from this table rather than from figures of
// its own. A build whose drawing and whose hit regions disagreed would be a menu
// that highlights one item and confirms another.
//
// Nothing here reads or writes state: a layout is a function of the SCREEN alone,
// which is what lets `menuItemRect` be a pure reading and what makes a region
// stable while a menu is up.

import {
  FIELD_CX,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";

/** The copy of the how-to screen's single item. Its wording is this build's. */
export const HOWTO_ITEMS = ["BACK"] as const;

/**
 * A hit region in logical units: `x`/`y` are the top-left corner, `w`/`h` the
 * size. This is the shape `menuItemRect` returns (specs/instrumentation.md).
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One menu's layout: the items, where the first one's CENTER sits, how far apart
 * the rows are, and the size of the region a pointer selects an item from.
 *
 * `width` and `height` are the hit region, not the glyphs: the region is a fixed
 * band around each row, wider than the longest label, so a pointer a few units
 * off the letters still selects the item a player was clearly aiming at. `height`
 * is deliberately smaller than `spacing`, so no two regions overlap and no point
 * is ambiguous.
 */
export interface MenuLayout {
  readonly items: readonly string[];
  /** The center x every row is centered on. */
  readonly centerX: number;
  /** The center y of item 0. */
  readonly startY: number;
  /** The distance from one row's center to the next. */
  readonly spacing: number;
  /** The glyph size the row is drawn at, in logical units. */
  readonly fontPx: number;
  /** The letter-spacing the row is drawn with, in logical units. */
  readonly letterSpacing: number;
  readonly width: number;
  readonly height: number;
}

export const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  startY: 430,
  spacing: 52,
  fontPx: 30,
  letterSpacing: 10,
  width: 420,
  height: 44,
};

export const HOWTO_MENU: MenuLayout = {
  items: HOWTO_ITEMS,
  centerX: FIELD_CX,
  startY: FIELD_H - 44,
  spacing: 52,
  fontPx: 26,
  letterSpacing: 8,
  width: 420,
  height: 44,
};

/** The pause panel is 400 tall and centered, so its top edge is at y = 160. */
export const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  startY: 360,
  spacing: 52,
  fontPx: 26,
  letterSpacing: 6,
  width: 420,
  height: 44,
};

/** The match-over panel is 420 tall and centered, so its top edge is at y = 150. */
export const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  startY: 418,
  spacing: 52,
  fontPx: 26,
  letterSpacing: 6,
  width: 420,
  height: 44,
};

/**
 * The menu the screen shows, or `null` on the two screens that show none.
 *
 * `countdown` and `playing` are the live field: they have no menu, which is why
 * `menuItemRect` reports nothing on them (specs/instrumentation.md).
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

/** How many items the screen's menu shows. `0` on a screen with no menu. */
export function menuItemCount(screen: Screen): number {
  return menuFor(screen)?.items.length ?? 0;
}

/** The center of item `index` in the layout, in logical units. */
export function itemCenter(
  layout: MenuLayout,
  index: number,
): { x: number; y: number } {
  return { x: layout.centerX, y: layout.startY + index * layout.spacing };
}

/**
 * The hit region of item `index` on `screen`, or `null` when the screen shows no
 * menu or the index names no item of it.
 *
 * This is exactly what the debug surface's `menuItemRect` reading returns, and
 * exactly the region {@link menuItemAt} tests a point against.
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = menuFor(screen);
  if (!layout) return null;
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  const center = itemCenter(layout, index);
  return {
    x: center.x - layout.width / 2,
    y: center.y - layout.height / 2,
    w: layout.width,
    h: layout.height,
  };
}

/** Whether a logical point falls inside a region, edges included. */
export function rectContains(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The index of the item `(x, y)` lands in on `screen`, or `-1` for a point
 * outside every region — which is the "no item" a pointer edge outside the menu
 * confirms (specs/ui.md).
 */
export function menuItemAt(screen: Screen, x: number, y: number): number {
  const layout = menuFor(screen);
  if (!layout) return -1;
  for (let index = 0; index < layout.items.length; index++) {
    const rect = menuItemRect(screen, index);
    if (rect && rectContains(rect, x, y)) return index;
  }
  return -1;
}
