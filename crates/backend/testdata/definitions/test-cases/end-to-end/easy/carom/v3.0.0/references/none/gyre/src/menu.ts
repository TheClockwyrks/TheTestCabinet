// Carom — the menus, as layout.
//
// A menu is a list of item captions and a set of hit regions, and BOTH the
// renderer and the pointer read them from here. That is the whole point of the
// module: `specs/ui.md` says a pointer selects the item whose region it moves
// onto, and `specs/instrumentation.md` says `menuItemRect` reports that region —
// so the region a player's mouse is tested against, the region the surface
// reports, and the place the caption is actually drawn have to be one fact rather
// than three that agree by hand.
//
// The layout itself is this build's own (the specification fixes the item copy
// and the order, not where they sit), so the figures below are chosen here and
// nowhere else. Every one is in the fixed 1280x720 logical space.

import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./game";
import { HOWTO_ITEM_TEXT } from "./theme";

/**
 * A hit region in logical units: `x`/`y` its top-left corner, `w`/`h` its size.
 *
 * The shape `menuItemRect` returns (specs/instrumentation.md), deliberately NOT
 * the corner pair `Rect` the playfield figures are written in.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One menu: its captions and where the column of them sits. */
export interface MenuLayout {
  readonly items: readonly string[];
  /** The center x every caption is drawn about, and every region centered on. */
  readonly centerX: number;
  /** The center y of item 0. */
  readonly startY: number;
  /** The vertical distance between consecutive item centers. */
  readonly spacing: number;
  /** The caption's font size, in logical units. */
  readonly fontPx: number;
  /** The caption's letter spacing, in logical units. */
  readonly letterSpacing: number;
}

/**
 * A hit region's size.
 *
 * Wider than the widest caption so a pointer aimed near a word still lands on it,
 * and shorter than {@link MenuLayout.spacing} so two neighbours can never both
 * claim one point.
 */
export const MENU_ITEM_W = 360;
export const MENU_ITEM_H = 44;

/** The panel the pause menu is laid out inside, in logical units. */
export const PAUSE_PANEL = { w: 520, h: 400 } as const;
/** The panel the match-over menu is laid out inside, in logical units. */
export const MATCHOVER_PANEL = { w: 560, h: 420 } as const;

/** The top edge of a centered panel of height `h`. */
export function panelTop(h: number): number {
  return FIELD_CY - h / 2;
}

const TITLE_MENU: MenuLayout = {
  items: TITLE_ITEMS,
  centerX: FIELD_CX,
  startY: 440,
  spacing: 52,
  fontPx: 30,
  letterSpacing: 10,
};

const HOWTO_MENU: MenuLayout = {
  items: [HOWTO_ITEM_TEXT],
  centerX: FIELD_CX,
  startY: FIELD_H - 44,
  spacing: 52,
  fontPx: 22,
  letterSpacing: 8,
};

const PAUSE_MENU: MenuLayout = {
  items: PAUSE_ITEMS,
  centerX: FIELD_CX,
  startY: panelTop(PAUSE_PANEL.h) + 200,
  spacing: 52,
  fontPx: 26,
  letterSpacing: 6,
};

const MATCHOVER_MENU: MenuLayout = {
  items: MATCHOVER_ITEMS,
  centerX: FIELD_CX,
  startY: panelTop(MATCHOVER_PANEL.h) + 268,
  spacing: 52,
  fontPx: 26,
  letterSpacing: 6,
};

/**
 * The menu the given screen shows, or `null` where it shows none.
 *
 * `countdown` and `playing` are the live field and carry no menu, which is the
 * case `menuItemRect` answers `null` for.
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
    default:
      return null;
  }
}

/** How many items the screen's menu shows; `0` where it shows no menu. */
export function menuItemCount(screen: Screen): number {
  return menuLayout(screen)?.items.length ?? 0;
}

/** Where item `index` of a laid-out menu sits. */
export function layoutItemRect(
  layout: MenuLayout,
  index: number,
): MenuRect | null {
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  return {
    x: layout.centerX - MENU_ITEM_W / 2,
    y: layout.startY + index * layout.spacing - MENU_ITEM_H / 2,
    w: MENU_ITEM_W,
    h: MENU_ITEM_H,
  };
}

/**
 * The hit region of item `index` on the menu `screen` shows, in logical units.
 *
 * `null` on a screen with no menu and for an index that names no item — the two
 * cases `specs/instrumentation.md` fixes for the reading.
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = menuLayout(screen);
  return layout === null ? null : layoutItemRect(layout, index);
}

/** Whether a logical point lies inside a region. */
export function rectContains(rect: MenuRect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The item of `screen`'s menu a logical point lands on, or `null` for a point
 * outside every region — which is a gesture that selects and confirms nothing.
 */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  for (let index = 0; index < layout.items.length; index++) {
    const rect = layoutItemRect(layout, index);
    if (rect !== null && rectContains(rect, x, y)) return index;
  }
  return null;
}
