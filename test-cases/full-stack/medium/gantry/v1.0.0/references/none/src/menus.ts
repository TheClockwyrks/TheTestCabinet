// Where this build lays its menu entries out, and what a pointer or a contact
// lands on.
//
// `specs/ui.md` leaves the layout of a menu to the build and fixes only that
// every entry occupies a rectangular hit region, that the pointer moved onto
// one selects that entry, and that a press and a release inside one takes it.
// This module IS that layout: `src/render-hud.ts` draws the entries at the
// rectangles it returns, `src/screens.ts` decides what a press or a contact
// took from them, and `src/debug.ts` reports them through `menuItemRect`. The
// three read the same numbers, so what is drawn, what is hit, and what is
// reported cannot drift apart.

import { SITE_COUNT, STAGE_W, TITLE_ITEMS } from "./constants";
import type { Rect } from "./screens-tape";
import { menuLength, resultsItems, type GantryState } from "./state";

/** The title menu's entries: a column under the tagline. */
const TITLE_MENU = { x: 120, y: 400, w: 380, h: 40, pitch: 48 } as const;

/** The results menu's entries: a column inside the results panel. */
const RESULTS_MENU = { x: 500, y: 412, w: 280, h: 40, pitch: 48 } as const;

/**
 * The select screen's site rows, which are its menu entries: full-width bands
 * inset from both edges by the screen layer's own margin.
 */
const SELECT_INSET = 60;
const SELECT_MENU = {
  x: SELECT_INSET,
  y: 152,
  w: STAGE_W - 2 * SELECT_INSET,
  h: 64,
  pitch: 76,
} as const;

/** A column of `count` entries laid out on one of the three shapes above. */
function column(
  shape: { x: number; y: number; w: number; h: number; pitch: number },
  count: number,
): Rect[] {
  return Array.from({ length: count }, (_unused, i) => ({
    x: shape.x,
    y: shape.y + i * shape.pitch,
    w: shape.w,
    h: shape.h,
  }));
}

/**
 * The hit region of every entry of the menu the screen is showing, in order.
 *
 * Empty on the four screens showing no menu, which is what `menuLength` reports
 * `0` for.
 */
export function menuRects(state: GantryState): Rect[] {
  switch (state.screen) {
    case "title":
      return column(TITLE_MENU, TITLE_ITEMS.length);
    case "select":
      return column(SELECT_MENU, SITE_COUNT);
    case "results":
      return column(RESULTS_MENU, resultsItems(state.siteIndex).length);
    default:
      return [];
  }
}

/** Whether a stage point lies inside a region, edges included. */
function inside(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/**
 * The entry a stage point lands on, or `null` for a point inside no region.
 *
 * The regions this module lays out never overlap, so the first match is the
 * only one.
 */
export function menuHit(
  state: GantryState,
  x: number,
  y: number,
): number | null {
  if (menuLength(state) === 0) return null;
  const index = menuRects(state).findIndex((rect) => inside(rect, x, y));
  return index < 0 ? null : index;
}
