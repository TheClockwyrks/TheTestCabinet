// Spectra — the menus: the items a screen shows, and the regions they occupy.
//
// `specs/ui.md` gives each menu screen its items and leaves where they sit to the
// build, and `specs/instrumentation.md` then asks the build to REPORT where it put
// them, through `menuItemRect`. So the layout is decided once, here: `src/render.ts`
// draws each item at the baseline this module computes, the debug surface reports
// the rectangle around it, and the pointer and the finger select through `itemAt` on
// those same rectangles. There is no second layout for any of the three to drift
// from.
//
// `howto`, `stageIntro`, `inWave` and `stageCleared` show no menu, so they have none
// here, which is what makes `menuItemRect` null on them.

import {
  GAME_OVER_ITEMS,
  PAUSE_ITEMS,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";

/** A hit region in logical units, with `x` and `y` its top-left corner. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one menu's items sit, in logical units. */
interface MenuStyle {
  /** The x every item is centred on. */
  readonly centerX: number;
  /** The middle of the first item's row. */
  readonly firstY: number;
  /** The distance from one item's row to the next. */
  readonly spacing: number;
  /** The hit region's width. */
  readonly hitW: number;
  /** The hit region's height. Shorter than the spacing, so regions never touch. */
  readonly hitH: number;
}

/** One menu: the items a screen shows, and the geometry they are laid out in. */
export interface Menu {
  readonly items: readonly string[];
  readonly style: MenuStyle;
}

/**
 * The plate the renderer draws behind a highlighted item, and its hit region.
 *
 * The items are set on a middle baseline, so an item's row IS the middle of its
 * region and no rise correction is needed.
 */
const METRICS = { spacing: 46, hitW: 420, hitH: 42 } as const;

const MENUS: Partial<Record<Screen, Menu>> = {
  title: {
    items: TITLE_ITEMS,
    style: { centerX: STAGE_W / 2, firstY: 390, ...METRICS },
  },
  paused: {
    items: PAUSE_ITEMS,
    style: { centerX: STAGE_W / 2, firstY: 330, ...METRICS },
  },
  gameOver: {
    items: GAME_OVER_ITEMS,
    style: { centerX: STAGE_W / 2, firstY: 400, ...METRICS },
  },
};

/** The menu a screen shows, or null on the four screens that show none. */
export function menuOf(screen: Screen): Menu | null {
  return MENUS[screen] ?? null;
}

/** The middle of item `index`'s row, which is where its text is drawn. */
export function itemRowY(menu: Menu, index: number): number {
  return menu.style.firstY + index * menu.style.spacing;
}

/** The region item `index` of `menu` occupies, or null past the end of it. */
export function itemRect(menu: Menu, index: number): MenuRect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menu.items.length) {
    return null;
  }
  const { style } = menu;
  return {
    x: style.centerX - style.hitW / 2,
    y: itemRowY(menu, index) - style.hitH / 2,
    w: style.hitW,
    h: style.hitH,
  };
}

/**
 * The region item `index` occupies on the menu `screen` shows.
 *
 * Null on the four screens that show no menu, and null for an index the current
 * menu has no item at — which is exactly what the reading
 * `specs/instrumentation.md` specifies returns.
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const menu = menuOf(screen);
  return menu === null ? null : itemRect(menu, index);
}

/**
 * Which item a menu draws as the highlighted one, given the selection.
 *
 * `menuIndex` is whatever the state carries, and the surface will set it to
 * anything (`specs/instrumentation.md`), so the drawing takes the nearest item
 * rather than highlighting none: a menu on screen always shows a player which item
 * a confirm would take.
 */
export function highlightedItem(menu: Menu, menuIndex: number): number {
  const last = menu.items.length - 1;
  if (!Number.isFinite(menuIndex)) return 0;
  return Math.min(Math.max(Math.round(menuIndex), 0), last);
}

/** Whether a logical point lies inside a region. */
export function rectContains(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * Which item of `menu` covers a logical point, if any.
 *
 * The regions never overlap — each is shorter than the spacing between two items —
 * so a point is inside at most one of them, and the first match is the answer.
 */
export function itemAt(menu: Menu, x: number, y: number): number | null {
  for (let index = 0; index < menu.items.length; index += 1) {
    const rect = itemRect(menu, index);
    if (rect !== null && rectContains(rect, x, y)) return index;
  }
  return null;
}
