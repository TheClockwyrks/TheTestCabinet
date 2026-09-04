// Wick — the menus, as areas on the stage (specs/ui.md, specs/controls.md
// "The pointer", specs/instrumentation.md "Menus").
//
// One definition of where every vertical menu and the almanac's tab bar are
// drawn, in logical stage units. It is the ONE definition: `src/render/`
// draws each item inside the rectangle this module gives it,
// `src/pointer.ts` hit-tests the pointer against the same rectangles, and
// the debug surface reports them as `menuRects` and `tabRects`. A renderer
// that drew a menu anywhere else would move the areas the pointer answers
// with it.
//
// The rectangles a screen shows are the items its menu CURRENTLY shows: the
// whole menu on `title`, `levelup`, `paused`, `fallen`, and `dawn`, and the
// visible window of the list on `almanac`, at most `ALMANAC_ROWS` rows from
// `almanacScroll`. `menuLength` is the whole menu, which is what a highlight
// wraps over, so on `almanac` it counts the tab's entries rather than its
// rows.

import { entriesOf } from "./almanac";
import {
  ALMANAC_ROWS,
  ALMANAC_TABS,
  END_ITEMS,
  PAUSE_ITEMS,
  STAGE_CX,
  STAGE_H,
  TITLE_ITEMS,
} from "./constants";
import type { WickState } from "./state";

/** A rectangle on the stage, in the coordinates the pointer is read in. */
export interface WickRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---- The stacked menus ------------------------------------------------------

/** One stacked item's area, and the distance between two of their tops. */
export const MENU_ITEM_WIDTH = 360;
export const MENU_ITEM_HEIGHT = 36;
export const MENU_ITEM_PITCH = 44;

/** The item's text baseline, from the top of its rectangle. */
export const MENU_ITEM_BASELINE = 26;

/** The top of each stacked menu's first item. */
export const TITLE_MENU_TOP = 394;
export const PAUSE_MENU_TOP = 414;
export const END_MENU_TOP = 424;

/** `count` items stacked from `top`, centered on the stage. */
export function stackedRects(count: number, top: number): WickRect[] {
  return Array.from({ length: count }, (_unused, i) => ({
    x: STAGE_CX - MENU_ITEM_WIDTH / 2,
    y: top + i * MENU_ITEM_PITCH,
    width: MENU_ITEM_WIDTH,
    height: MENU_ITEM_HEIGHT,
  }));
}

// ---- The level-up overlay ---------------------------------------------------

/** One offer row's area, and the distance between two of their tops. */
export const OFFER_ROW_WIDTH = 540;
export const OFFER_ROW_HEIGHT = 60;
export const OFFER_ROW_PITCH = 72;

/** The overlay's panel, sized to the offers it presents and centered. */
export function levelUpPanel(rows: number): WickRect {
  const height = 152 + rows * OFFER_ROW_PITCH;
  return {
    x: STAGE_CX - 300,
    y: (STAGE_H - height) / 2,
    width: 600,
    height,
  };
}

/** The `rows` offer rows, in list order. */
export function offerRects(rows: number): WickRect[] {
  const panel = levelUpPanel(rows);
  return Array.from({ length: rows }, (_unused, i) => ({
    x: STAGE_CX - OFFER_ROW_WIDTH / 2,
    y: panel.y + 88 + i * OFFER_ROW_PITCH,
    width: OFFER_ROW_WIDTH,
    height: OFFER_ROW_HEIGHT,
  }));
}

// ---- The almanac ------------------------------------------------------------

/** The tab bar: `ALMANAC_TABS.length` tabs in a row, centered. */
export const TAB_WIDTH = 220;
export const TAB_HEIGHT = 40;
export const TAB_GAP = 16;
export const TAB_TOP = 106;

/** The entry list down the left, `ALMANAC_ROWS` rows of `ROW_HEIGHT`. */
export const LIST_X = 96;
export const LIST_WIDTH = 300;
export const LIST_TOP = 180;
export const ROW_HEIGHT = 40;

/** The detail pane, to the right of the list. */
export const DETAIL: WickRect = {
  x: 430,
  y: LIST_TOP,
  width: 754,
  height: ALMANAC_ROWS * ROW_HEIGHT,
};

/** The whole tab bar, in `ALMANAC_TABS` order. */
export function tabBarRects(): WickRect[] {
  const span =
    ALMANAC_TABS.length * TAB_WIDTH + (ALMANAC_TABS.length - 1) * TAB_GAP;
  const left = STAGE_CX - span / 2;
  return ALMANAC_TABS.map((_unused, i) => ({
    x: left + i * (TAB_WIDTH + TAB_GAP),
    y: TAB_TOP,
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
  }));
}

/** The `rows` visible entry rows, in list order from `almanacScroll`. */
export function rowRects(rows: number): WickRect[] {
  return Array.from({ length: rows }, (_unused, i) => ({
    x: LIST_X,
    y: LIST_TOP + i * ROW_HEIGHT,
    width: LIST_WIDTH,
    height: ROW_HEIGHT,
  }));
}

/** How many rows the almanac's list shows: its window over the tab. */
export function visibleRows(state: WickState): number {
  const left = entriesOf(state.almanacTab).length - state.almanacScroll;
  return Math.max(0, Math.min(ALMANAC_ROWS, left));
}

// ---- What the current screen shows ------------------------------------------

/**
 * How many items the current screen's menu holds: what a highlight wraps
 * over. On `almanac` that is every entry of the shown tab, since the list is
 * a window over them.
 */
export function menuLength(state: WickState): number {
  switch (state.screen) {
    case "title":
      return TITLE_ITEMS.length;
    case "almanac":
      return entriesOf(state.almanacTab).length;
    case "levelup":
      return state.run.offers.length;
    case "paused":
      return PAUSE_ITEMS.length;
    case "fallen":
    case "dawn":
      return END_ITEMS.length;
    default:
      return 0;
  }
}

/**
 * The rectangles of the current screen's vertical menu, in menu order, and an
 * empty list on a screen with no menu.
 */
export function menuRects(state: WickState): WickRect[] {
  switch (state.screen) {
    case "title":
      return stackedRects(TITLE_ITEMS.length, TITLE_MENU_TOP);
    case "almanac":
      return rowRects(visibleRows(state));
    case "levelup":
      return offerRects(state.run.offers.length);
    case "paused":
      return stackedRects(PAUSE_ITEMS.length, PAUSE_MENU_TOP);
    case "fallen":
    case "dawn":
      return stackedRects(END_ITEMS.length, END_MENU_TOP);
    default:
      return [];
  }
}

/** The rectangles of the almanac's tab bar, and an empty list elsewhere. */
export function tabRects(state: WickState): WickRect[] {
  return state.screen === "almanac" ? tabBarRects() : [];
}

/** The index of the rectangle holding `(x, y)`, or `-1` when none does. */
export function rectAt(
  rects: readonly WickRect[],
  x: number,
  y: number,
): number {
  return rects.findIndex(
    (rect) =>
      x >= rect.x &&
      x < rect.x + rect.width &&
      y >= rect.y &&
      y < rect.y + rect.height,
  );
}
