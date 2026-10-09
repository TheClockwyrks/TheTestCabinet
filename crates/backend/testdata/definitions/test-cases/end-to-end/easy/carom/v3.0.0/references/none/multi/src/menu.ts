// Carom — the menus, as laid-out geometry.
//
// `specs/ui.md` gives every menu screen its items and says each item occupies "a
// rectangular hit region the build lays out"; `specs/instrumentation.md` says the
// build reports that region through `menuItemRect`, in logical units. This module
// is that layout, and it is the ONLY place it exists: `src/render.ts` draws each
// item at the center of the rectangle this file computes, `src/game.ts` resolves a
// pointer or a touch contact to an item through {@link menuItemAt}, and
// `src/debug.ts` reports the same rectangle through {@link menuItemRect}. A menu
// therefore cannot be drawn in one place and reported in another.
//
// The two live screens show no menu, so both answer `null` here — which is
// exactly what the reading is specified to return on them.

import { MATCHOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import {
  HOWTO_ITEMS,
  HOWTO_MENU,
  MATCHOVER_MENU,
  PAUSE_MENU,
  TITLE_MENU,
  type MenuGeometry,
} from "./theme";
import type { Screen } from "./game";

/**
 * One item's hit region, in logical units: `x` and `y` are its top-left corner
 * and `w` and `h` its size. The shape `menuItemRect` returns.
 */
export interface MenuItemRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One menu screen's items, laid out. */
export interface MenuLayout {
  /** The copy of each item, in the order the specification gives them. */
  readonly items: readonly string[];
  /** Where the menu sits and how it is drawn. */
  readonly geometry: MenuGeometry;
  /** Each item's hit region, in the same order. */
  readonly rects: readonly MenuItemRect[];
}

/** The center of item `index` under `geometry`, in logical units. */
export function menuItemCenter(
  geometry: MenuGeometry,
  index: number,
): { x: number; y: number } {
  return {
    x: geometry.centerX,
    y: geometry.startY + index * geometry.spacing,
  };
}

function layOut(items: readonly string[], geometry: MenuGeometry): MenuLayout {
  const rects = items.map((_item, index) => {
    const center = menuItemCenter(geometry, index);
    return {
      x: center.x - geometry.width / 2,
      y: center.y - geometry.height / 2,
      w: geometry.width,
      h: geometry.height,
    };
  });
  return { items, geometry, rects };
}

/**
 * The menu the given screen shows, laid out — or `null` on `countdown` and
 * `playing`, which show no menu at all.
 */
export function menuLayout(screen: Screen): MenuLayout | null {
  switch (screen) {
    case "title":
      return layOut(TITLE_ITEMS, TITLE_MENU);
    case "howto":
      return layOut(HOWTO_ITEMS, HOWTO_MENU);
    case "paused":
      return layOut(PAUSE_ITEMS, PAUSE_MENU);
    case "matchover":
      return layOut(MATCHOVER_ITEMS, MATCHOVER_MENU);
    case "countdown":
    case "playing":
      return null;
  }
}

/** How many items the current screen's menu shows; `0` where there is none. */
export function menuItemCount(screen: Screen): number {
  return menuLayout(screen)?.items.length ?? 0;
}

/**
 * The hit region of item `index` on the menu `screen` shows.
 *
 * `null` on the two live screens, and `null` where `index` names no item of the
 * menu that screen does show — which includes a fractional or negative index,
 * because neither names an item either.
 */
export function menuItemRect(
  screen: Screen,
  index: number,
): MenuItemRect | null {
  const layout = menuLayout(screen);
  if (layout === null || !Number.isInteger(index)) return null;
  return layout.rects[index] ?? null;
}

/** Whether a logical point lies inside a hit region. */
export function rectContains(
  rect: MenuItemRect,
  x: number,
  y: number,
): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The item of `screen`'s menu a logical point falls in, or `null` for a point
 * outside every region — which is what a pointer that has wandered off the menu,
 * or one on a screen with no menu at all, reports.
 */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  for (let index = 0; index < layout.rects.length; index += 1) {
    if (rectContains(layout.rects[index], x, y)) return index;
  }
  return null;
}
