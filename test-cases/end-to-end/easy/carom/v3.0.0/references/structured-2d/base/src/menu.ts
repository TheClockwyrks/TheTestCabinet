// Carom — the menus as geometry: which items each screen shows, where this
// build puts them, and which item a point lands on.
//
// specs/ui.md drives every menu screen with a mouse and a finger as well as
// with the keyboard, over "a rectangular hit region the build lays out", and
// specs/instrumentation.md has the build REPORT that region through
// `menuItemRect`. So the layout cannot live inside a draw call: the pointer
// handling, the reading, and the drawing all have to agree, which they do here
// by all three reading this one table.
//
// Every figure below is this build's own choice — the case fixes the item copy
// (`TITLE_ITEMS`, `PAUSE_ITEMS`, `MATCHOVER_ITEMS`) and leaves the placement to
// the build — and the regions are stated in the field's logical units, which is
// the space `menuItemRect` reports in and the space the engine hands a pointer
// position in.
//
// The hit region is deliberately a plain rectangle around the item's line
// rather than the text's measured extent: a region computed from the type
// metrics would need a canvas, and `menuItemRect` is a pure reading a caller
// may make on any frame, before anything has been drawn.

import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./state";
import { HOWTO_ITEMS } from "./theme";

/**
 * A hit region in logical units: `x` and `y` the top-left corner, `w` and `h`
 * the size, as specs/instrumentation.md fixes for `menuItemRect`.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One menu's items and where this build lays them out. */
export interface MenuLayout {
  /** The item copy, in the order the screen shows it. */
  readonly items: readonly string[];
  /** The x every item is centred on. */
  readonly centerX: number;
  /** The y of the FIRST item's centre. */
  readonly startY: number;
  /** The vertical distance between one item's centre and the next. */
  readonly spacing: number;
  /** The type size the items are drawn at, in logical units. */
  readonly size: number;
  /** The letter-spacing the items are drawn with. */
  readonly tracking: number;
  /** The width of each item's hit region. */
  readonly width: number;
  /** The height of each item's hit region. */
  readonly height: number;
}

/** The pause panel's box, which the pause menu is laid out inside. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;

/** The match-over panel's box. */
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;

/** The top edge of a panel centred on the field. */
function panelTop(height: number): number {
  return FIELD_CY - height / 2;
}

/** The title menu: the three `TITLE_ITEMS`, under the wordmark. */
export const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  startY: 430,
  spacing: 52,
  size: 30,
  tracking: 10,
  width: 460,
  height: 46,
};

/** The how-to page's single item, at the foot of the page. */
export const HOWTO_MENU: MenuLayout = {
  items: HOWTO_ITEMS,
  centerX: FIELD_CX,
  startY: FIELD_H - 52,
  spacing: 52,
  size: 24,
  tracking: 8,
  width: 320,
  height: 44,
};

/** The pause menu, inside the pause panel. */
export const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  startY: panelTop(PAUSE_PANEL.h) + 200,
  spacing: 52,
  size: 26,
  tracking: 6,
  width: 420,
  height: 44,
};

/** The match-over menu, inside the match-over panel. */
export const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  startY: panelTop(MATCHOVER_PANEL.h) + 268,
  spacing: 52,
  size: 26,
  tracking: 6,
  width: 420,
  height: 44,
};

/**
 * Every menu, by the screen that shows it. `countdown` and `playing` show none,
 * which is what makes `menuItemRect` report `null` there.
 */
export const MENUS: Readonly<Record<Screen, MenuLayout | null>> = {
  title: TITLE_MENU,
  howto: HOWTO_MENU,
  countdown: null,
  playing: null,
  paused: PAUSE_MENU,
  matchover: MATCHOVER_MENU,
};

/** How many items the screen's menu holds. `0` when it shows no menu. */
export function menuItemCount(screen: Screen): number {
  return MENUS[screen]?.items.length ?? 0;
}

/** The centre y of item `index` on a menu. */
export function menuItemY(layout: MenuLayout, index: number): number {
  return layout.startY + index * layout.spacing;
}

/**
 * The hit region of item `index` on the menu `screen` shows, and `null` when
 * that screen shows no menu or `index` names no item of it
 * (specs/instrumentation.md).
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = MENUS[screen];
  if (layout === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  return {
    x: layout.centerX - layout.width / 2,
    y: menuItemY(layout, index) - layout.height / 2,
    w: layout.width,
    h: layout.height,
  };
}

/** Whether a point in logical units falls inside a region. */
export function rectContains(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The index of the item a point lands on, or `null` for a point outside every
 * region — which is what specs/ui.md calls an edge that "falls outside every
 * region", and confirms nothing.
 */
export function menuHitTest(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const layout = MENUS[screen];
  if (layout === null) return null;
  for (let index = 0; index < layout.items.length; index++) {
    const rect = menuItemRect(screen, index);
    if (rect !== null && rectContains(rect, x, y)) return index;
  }
  return null;
}
