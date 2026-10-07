// Coil — the items each menu-bearing screen holds (specs/ui.md).
//
// One source of truth for both halves: the router moves the highlight and accepts
// an item by its index here, and the renderer lays the same list out. The `playing`
// screen carries no menu, so its list is empty and its highlight rests at 0.
//
// `src/constants.ts` fixes the three menus whose copy the specification names. The
// how-to-play screen's one item is not among them, because `specs/ui.md` fixes
// only that `back` returns to the title from there, so its wording is this build's.

import {
  OVER_ITEMS,
  PAUSE_ITEMS,
  STAGE_CX,
  TITLE_ITEMS,
  type Screen,
} from "./constants";

/** The one item the how-to-play screen's menu holds. */
export const HOWTO_ITEMS: readonly string[] = ["BACK"];

/** The items `screen` holds, in the order they are drawn. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "howto":
      return HOWTO_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
    case "cleared":
      return OVER_ITEMS;
    case "playing":
      return [];
  }
}

// ---- Where a menu sits ------------------------------------------------------
//
// One layout per menu-bearing screen, read by both halves: `src/render.ts` draws
// each item from it, and `menuItemRect` reports the region an item occupies, which
// is the reading `specs/instrumentation.md` requires and the region a pointer or a
// touch contact selects that item from (`specs/ui.md`).

/** How a screen lays its menu out, in logical units. */
export interface MenuLayout {
  /** The x every label is centred on. */
  centerX: number;
  /** The y the first item's centre sits at. */
  topY: number;
  /** The distance from one item's centre to the next. */
  gap: number;
  /** The type size the labels are drawn at. */
  size: number;
}

/** The hit region of one menu item, in logical units. */
export interface MenuRect {
  /** The region's left edge. */
  x: number;
  /** The region's top edge. */
  y: number;
  /** How wide the region is. */
  w: number;
  /** How tall the region is. */
  h: number;
}

const LAYOUTS: Record<Screen, MenuLayout | null> = {
  title: { centerX: STAGE_CX, topY: 516, gap: 58, size: 30 },
  howto: { centerX: STAGE_CX, topY: 660, gap: 40, size: 24 },
  playing: null,
  paused: { centerX: STAGE_CX, topY: 358, gap: 50, size: 26 },
  gameover: { centerX: STAGE_CX, topY: 482, gap: 52, size: 30 },
  cleared: { centerX: STAGE_CX, topY: 482, gap: 52, size: 30 },
};

/** How `screen` lays its menu out, or `null` when it carries no menu. */
export function menuLayout(screen: Screen): MenuLayout | null {
  return LAYOUTS[screen];
}

/**
 * How wide an item's region is.
 *
 * Wider than the longest label the menus carry, so a pointer aimed a little wide
 * of the text still lands on the entry it was aimed at, and narrow enough to sit
 * inside the panels the pause and end screens draw their menus on.
 */
const ITEM_WIDTH = 480;

/** The clearance left between one item's region and the next. */
const ITEM_MARGIN = 8;

/**
 * The hit region item `index` occupies on `screen`.
 *
 * `null` on `playing`, which shows no menu, and for an index the screen's menu
 * holds no item at.
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = LAYOUTS[screen];
  if (layout === null) return null;
  if (!Number.isInteger(index)) return null;
  if (index < 0 || index >= menuItems(screen).length) return null;
  const h = layout.gap - ITEM_MARGIN;
  return {
    x: layout.centerX - ITEM_WIDTH / 2,
    y: layout.topY + index * layout.gap - h / 2,
    w: ITEM_WIDTH,
    h,
  };
}

/** The item whose region holds the logical point, or `null` when none does. */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const items = menuItems(screen);
  for (let index = 0; index < items.length; index++) {
    const rect = menuItemRect(screen, index);
    if (rect === null) continue;
    const inside =
      x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    if (inside) return index;
  }
  return null;
}
