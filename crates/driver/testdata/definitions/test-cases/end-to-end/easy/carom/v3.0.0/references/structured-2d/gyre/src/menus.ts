// Carom — the menus' layout: the items each screen shows and the rectangle each
// one is selected from.
//
// The case fixes the COPY of every menu (`TITLE_ITEMS`, `PAUSE_ITEMS`,
// `MATCHOVER_ITEMS`) and leaves the LAYOUT to the build (specs/ui.md), so this
// module is where the build states where it puts them — once, in the field's
// logical units. Two readers share it and cannot drift apart:
//
//   * `src/screens.ts` draws each menu from the same layout, so what a player
//     sees is where the game listens.
//   * `menuItemRect` on the debug surface (`src/debug.ts`) reports a region
//     straight out of it, which is how a caller driving the game with a mouse
//     or a finger finds the item it means (specs/instrumentation.md).
//
// The how-to page's single item is the build's own copy, drawn the way the
// other menus draw the item at `menuIndex` (specs/ui.md).

import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./state";

/** A hit region in logical units: `x`/`y` its top-left corner, `w`/`h` its size. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One vertical menu: its copy, where it starts, and how big each item is. */
export interface MenuLayout {
  readonly items: readonly string[];
  /** The x every item is centered on. */
  readonly centerX: number;
  /** The center y of item 0. */
  readonly firstY: number;
  /** The vertical step from one item's center to the next. */
  readonly spacing: number;
  /** The hit region's width. */
  readonly itemW: number;
  /** The hit region's height. Kept under `spacing`, so no two regions touch. */
  readonly itemH: number;
  /** The type size the items are drawn at. */
  readonly textSize: number;
  /** The letter spacing the items are drawn with. */
  readonly letterSpacing: number;
}

/** The how-to page's one item. Its copy is the build's (specs/ui.md). */
export const HOWTO_ITEMS = ["BACK TO TITLE"] as const;

/** The pause panel, centered on the field. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;
/** The match-over panel, centered on the field. */
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;

const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  firstY: 430,
  spacing: 52,
  itemW: 440,
  itemH: 44,
  textSize: 30,
  letterSpacing: 10,
};

const HOWTO_MENU: MenuLayout = {
  items: HOWTO_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_H - 46,
  spacing: 52,
  itemW: 380,
  itemH: 44,
  textSize: 22,
  letterSpacing: 8,
};

const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_CY - PAUSE_PANEL.h / 2 + 200,
  spacing: 52,
  itemW: 420,
  itemH: 44,
  textSize: 26,
  letterSpacing: 6,
};

const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  firstY: FIELD_CY - MATCHOVER_PANEL.h / 2 + 268,
  spacing: 52,
  itemW: 420,
  itemH: 44,
  textSize: 26,
  letterSpacing: 6,
};

/**
 * The menu the given screen shows, or `null` on `countdown` and `playing`,
 * which show none.
 */
export function menuLayout(screen: Screen): MenuLayout | null {
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

/** How many items the given screen's menu shows. `0` where there is none. */
export function menuItemCount(screen: Screen): number {
  return menuLayout(screen)?.items.length ?? 0;
}

/** The hit region of item `index` within one layout. */
export function itemRect(layout: MenuLayout, index: number): MenuRect {
  return {
    x: layout.centerX - layout.itemW / 2,
    y: layout.firstY + index * layout.spacing - layout.itemH / 2,
    w: layout.itemW,
    h: layout.itemH,
  };
}

/**
 * The hit region of item `index` on the menu the given screen shows, in logical
 * units — `null` on a screen with no menu, and for an index that names no item
 * of it (specs/instrumentation.md).
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  return itemRect(layout, index);
}

/**
 * The item whose region contains the logical point, or `null` when the point
 * falls outside every one of them — which is the edge that confirms no item.
 */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  for (let index = 0; index < layout.items.length; index++) {
    const rect = itemRect(layout, index);
    if (
      x >= rect.x &&
      x <= rect.x + rect.w &&
      y >= rect.y &&
      y <= rect.y + rect.h
    ) {
      return index;
    }
  }
  return null;
}
