// Orrery — the editor's five regions (specs/editor.md "Layout") and the menus'
// hit regions (specs/ui.md "Menu navigation", specs/instrumentation.md
// "The menu layout").
//
// The heading, the tray, the field, the readout, and the tape panel divide the
// whole stage between them, and a press is answered by the region it lands in:
// the heading and the readout are display only and answer nothing, the tray
// begins a placement, the field selects and drags, and the tape panel points
// the cursor.
//
// EVERY rectangle this game fixes includes its lower bound and excludes its
// upper, so a point on a shared edge belongs to the region below and to the
// right of it. That single rule decides the two corners the specification calls
// out: `(TRAY_REGION_W, HEADING_H)` is the field's, and
// `(TRAY_REGION_W, TAPE_Y0)` is the tape panel's.
//
// The menu figures below are this build's OWN — "Each menu item occupies a
// rectangular hit region the build lays out" — which is why they are here
// rather than in `src/constants.ts`, where the figures the specification fixes
// are. They are written once and read twice: `src/screens.ts` and
// `src/panels.ts` draw each item's highlight over the rectangle its function
// returns, and `src/game.ts` answers `menuItemRect` and hit-tests the pointer
// against the same one. That is the whole point of the reading — the menus keep
// the layout the build chose, and a pointer aimed at the middle of a reported
// region lands on the item that was drawn there.

import {
  HEADING_H,
  READOUT_X0,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";

/** A rectangle on the stage, its lower bounds included and its upper excluded. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The five regions the editor divides the stage into. */
export type EditorRegion = "heading" | "tray" | "field" | "readout" | "tape";

/** Whether a point lies inside a half-open rectangle. */
export function insideRect(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return x >= x0 && x < x1 && y >= y0 && y < y1;
}

/**
 * Which region a stage position lies in, and `null` off the stage. The tests
 * run in the order the regions tile the stage: the heading spans the full
 * width, the tray the full height below it, the tape panel the width right of
 * the tray below `TAPE_Y0`, and the field and the readout share what is left.
 */
export function regionAt(x: number, y: number): EditorRegion | null {
  if (!insideRect(x, y, 0, 0, STAGE_W, STAGE_H)) return null;
  if (y < HEADING_H) return "heading";
  if (x < TRAY_REGION_W) return "tray";
  if (y >= TAPE_Y0) return "tape";
  return x < READOUT_X0 ? "field" : "readout";
}

/**
 * Whether a stage position lies inside the tape panel's extent,
 * `x >= TRAY_REGION_W` and `y >= TAPE_Y0` (specs/controls.md "Focus"). This is
 * the focus rule's own test, which is stated over the panel's extent rather
 * than over the region tiling, so a press below the tray's foot still reads as
 * a field press.
 */
export function insideTapePanel(x: number, y: number): boolean {
  return x >= TRAY_REGION_W && y >= TAPE_Y0;
}

// ---------------------------------------------------------------------------
// The menus
// ---------------------------------------------------------------------------

/**
 * One menu item's hit region, in the stage's logical units, `x` and `y` its
 * top-left corner (specs/instrumentation.md "The menu layout"). Plain data,
 * built at the call, so the surface hands out no live rectangle.
 */
export interface MenuItemRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Which menu a screen shows: one of the four of specs/ui.md. */
export type MenuKind = "title" | "howto" | "select" | "solved";

/** The width of a title-menu item's box, and of the how-to's one item. */
const MENU_ITEM_W = 300;
/** The height of both of those boxes. */
const MENU_ITEM_H = 34;
/** Their left edge, centered on the stage. */
const MENU_ITEM_X = STAGE_CX - MENU_ITEM_W / 2;
/** The top edge of the title menu's first item. */
const TITLE_ITEM_TOP = 332;
/** How far apart the title menu stacks its items. */
const TITLE_ITEM_STEP = 46;
/** The top edge of the how-to's one item, clear of the page body and the footer. */
const HOWTO_ITEM_TOP = 572;
/** How far a title or how-to item's text baseline sits below its box's top. */
export const MENU_TEXT_BASELINE = 24;

/** The left edge of a select row's box. */
const SELECT_ROW_X = 200;
/** A select row's width: the stage less an equal margin either side. */
const SELECT_ROW_W = STAGE_W - 2 * SELECT_ROW_X;
/** The top edge of the first select row's box. */
const SELECT_ROW_TOP = 120;
/** How far a select row's text baseline sits below its box's top. */
export const SELECT_TEXT_BASELINE = 20;
/** A list longer than this is drawn on the tighter row pitch, so it still fits. */
const SELECT_LONG_LIST = 12;
/** The two row pitches, for a short list and for a long one. */
const SELECT_ROW_STEP = { short: 40, long: 34 } as const;
/** The gap left between one row's box and the next. */
const SELECT_ROW_GAP = 4;

/** The solved panel's width. */
export const SOLVED_PANEL_W = 460;
/** The solved panel's height. */
export const SOLVED_PANEL_H = 330;
/** The solved panel's left edge, centered on the stage. */
export const SOLVED_PANEL_X = STAGE_CX - SOLVED_PANEL_W / 2;
/** The solved panel's top edge. */
export const SOLVED_PANEL_Y = 150;
/** How far a solved item's box is inset from the panel's edge. */
const SOLVED_ITEM_INSET = 24;
/** The top edge of the solved panel's first item. */
const SOLVED_ITEM_TOP = SOLVED_PANEL_Y + 178;
/** How far apart the solved panel stacks its items. */
const SOLVED_ITEM_STEP = 30;
/** A solved item's box height. */
const SOLVED_ITEM_H = 26;
/** How far a solved item's text baseline sits below its box's top. */
export const SOLVED_TEXT_BASELINE = 18;

/** The region the title menu's item `index` occupies. */
export function titleItemRect(index: number): MenuItemRect {
  return {
    x: MENU_ITEM_X,
    y: TITLE_ITEM_TOP + index * TITLE_ITEM_STEP,
    w: MENU_ITEM_W,
    h: MENU_ITEM_H,
  };
}

/**
 * The region the how-to's single item occupies. The how-to carries one item,
 * index `0`, and it is drawn as the title menu draws the item at `menuIndex`
 * (specs/ui.md `howto`).
 */
export function howtoItemRect(): MenuItemRect {
  return {
    x: MENU_ITEM_X,
    y: HOWTO_ITEM_TOP,
    w: MENU_ITEM_W,
    h: MENU_ITEM_H,
  };
}

/** How tall one row of a select list of `rows` challenges is drawn. */
export function selectRowStep(rows: number): number {
  return rows > SELECT_LONG_LIST ? SELECT_ROW_STEP.long : SELECT_ROW_STEP.short;
}

/** The region the select screen's row `index` occupies, in a list of `rows`. */
export function selectRowRect(index: number, rows: number): MenuItemRect {
  const step = selectRowStep(rows);
  return {
    x: SELECT_ROW_X,
    y: SELECT_ROW_TOP + index * step,
    w: SELECT_ROW_W,
    h: step - SELECT_ROW_GAP,
  };
}

/** The region the solved panel's item `index` occupies. */
export function solvedItemRect(index: number): MenuItemRect {
  return {
    x: SOLVED_PANEL_X + SOLVED_ITEM_INSET,
    y: SOLVED_ITEM_TOP + index * SOLVED_ITEM_STEP,
    w: SOLVED_PANEL_W - 2 * SOLVED_ITEM_INSET,
    h: SOLVED_ITEM_H,
  };
}

/**
 * The region item `index` of a menu of `count` items occupies. The count is
 * only the select screen's business — its rows are drawn tighter the longer
 * the list runs — and the other three menus ignore it.
 */
export function menuItemRectOf(
  kind: MenuKind,
  index: number,
  count: number,
): MenuItemRect {
  switch (kind) {
    case "title":
      return titleItemRect(index);
    case "howto":
      return howtoItemRect();
    case "select":
      return selectRowRect(index, count);
    case "solved":
      return solvedItemRect(index);
  }
}

/** Whether a stage position lies inside a menu item's region. */
export function rectHolds(rect: MenuItemRect, x: number, y: number): boolean {
  return insideRect(x, y, rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
}
