// Wick — where every menu sits on the stage (specs/ui.md, specs/controls.md
// "The pointer", specs/instrumentation.md "Menus").
//
// One definition of each rectangle, read by the renderer that draws the item
// and by the pointer that finds it, so a hover and a click land exactly on
// what the player sees. Everything here is in stage units, `0` to `STAGE_W`
// across and `0` to `STAGE_H` down, and no two rectangles of one screen meet.

import { almanacEntries, visibleRows } from "./almanac";
import {
  ALMANAC_TABS,
  END_ITEMS,
  PAUSE_ITEMS,
  STAGE_CX,
  STAGE_H,
  TITLE_ITEMS,
} from "./constants";
import type { WickState } from "./state";

/** An axis-aligned rectangle on the stage, given by its top-left corner. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether `(x, y)` falls inside `rect`, its top and left edges included. */
export function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x < rect.x + rect.width &&
    y >= rect.y &&
    y < rect.y + rect.height
  );
}

// ---- The vertical menus ------------------------------------------------------

/** The pitch of a vertical menu's items. */
export const MENU_LINE = 44;
/** One item's box, narrower than the pitch so no two boxes meet. */
const MENU_WIDTH = 360;
const MENU_HEIGHT = 36;
/** The baseline of an item's text within its box. */
export const MENU_BASELINE = 26;

/** The first item's top on `title`, on `paused`, and on an end screen. */
const TITLE_MENU_TOP = 394;
const PAUSE_MENU_TOP = 414;
const END_MENU_TOP = 424;

/** The boxes of a centered stack of `count` items whose first top is `top`. */
function stack(count: number, top: number): Rect[] {
  return Array.from({ length: count }, (_unused, i) => ({
    x: STAGE_CX - MENU_WIDTH / 2,
    y: top + i * MENU_LINE,
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
  }));
}

/** The stack on `title`. */
export function titleRects(): Rect[] {
  return stack(TITLE_ITEMS.length, TITLE_MENU_TOP);
}

/** The stack on `paused`. */
export function pauseRects(): Rect[] {
  return stack(PAUSE_ITEMS.length, PAUSE_MENU_TOP);
}

/** The stack on `fallen` and `dawn`. */
export function endRects(): Rect[] {
  return stack(END_ITEMS.length, END_MENU_TOP);
}

// ---- The way out of `howto` and `chest` --------------------------------------
//
// Neither screen shows a menu, and each answers the pointer and touch on one
// box: "the area the screen's way out is taken in, which the screen shows"
// (specs/controls.md). `src/render/screens.ts` draws the line inside that box,
// so what is tapped is what is read.

const DISMISS_WIDTH = 320;
const DISMISS_HEIGHT = 36;

/** The baseline of the line drawn inside a dismiss box, from its top. */
export const DISMISS_BASELINE = 25;

/** The tops of the two boxes: above the how-to's foot, inside the chest panel. */
export const HOWTO_DISMISS_TOP = STAGE_H - 85;
export const CHEST_DISMISS_TOP = 425;

/** A dismiss box, centered on the stage, whose top is `top`. */
function dismiss(top: number): Rect {
  return {
    x: STAGE_CX - DISMISS_WIDTH / 2,
    y: top,
    width: DISMISS_WIDTH,
    height: DISMISS_HEIGHT,
  };
}

/** The one box on `howto`, which `back` is taken in. */
export function howtoRects(): Rect[] {
  return [dismiss(HOWTO_DISMISS_TOP)];
}

/** The one box on `chest`, which `confirm` is taken in. */
export function chestRects(): Rect[] {
  return [dismiss(CHEST_DISMISS_TOP)];
}

// ---- The level-up overlay ----------------------------------------------------

/** The pitch of the overlay's offers. */
const OFFER_LINE = 72;
const OFFER_WIDTH = 540;
const OFFER_HEIGHT = 60;
/** The panel above and below the offers: the heading and the description. */
const OFFER_HEAD = 96;
const OFFER_FOOT = 72;

/** The overlay's panel, its offer boxes, and the line beneath them. */
export interface LevelUpLayout {
  readonly panel: Rect;
  readonly offers: readonly Rect[];
  /** The baseline of the description line under the offer list. */
  readonly descriptionY: number;
}

/** The overlay's layout for `count` offers, centered on the stage. */
export function levelUpLayout(count: number): LevelUpLayout {
  const height = OFFER_HEAD + count * OFFER_LINE + OFFER_FOOT;
  const top = (STAGE_H - height) / 2;
  return {
    panel: { x: STAGE_CX - 300, y: top, width: 600, height },
    offers: Array.from({ length: count }, (_unused, i) => ({
      x: STAGE_CX - OFFER_WIDTH / 2,
      y: top + OFFER_HEAD - 8 + i * OFFER_LINE,
      width: OFFER_WIDTH,
      height: OFFER_HEIGHT,
    })),
    descriptionY: top + height - 26,
  };
}

// ---- The almanac -------------------------------------------------------------

/** The almanac's tab bar, entry list, and detail pane, in stage units. */
export const ALMANAC = {
  /** The heading's baseline. */
  headingY: 76,
  /** One tab of the bar. */
  tabTop: 104,
  tabWidth: 200,
  tabHeight: 40,
  tabPitch: 212,
  /** One row of the entry list. */
  listX: 96,
  listTop: 180,
  rowWidth: 300,
  rowHeight: 34,
  rowPitch: 40,
  /** The pane the highlighted entry is shown in full in. */
  paneX: 432,
  paneY: 176,
  paneWidth: 752,
  paneHeight: 400,
} as const;

/** The first tab's left edge, so the bar is centered on the stage. */
const TAB_LEFT =
  STAGE_CX -
  (ALMANAC.tabPitch * (ALMANAC_TABS.length - 1) + ALMANAC.tabWidth) / 2;

/** The boxes of the tab bar, in `ALMANAC_TABS` order. */
export function almanacTabRects(): Rect[] {
  return Array.from({ length: ALMANAC_TABS.length }, (_unused, i) => ({
    x: TAB_LEFT + i * ALMANAC.tabPitch,
    y: ALMANAC.tabTop,
    width: ALMANAC.tabWidth,
    height: ALMANAC.tabHeight,
  }));
}

/** The boxes of the visible entry rows, in list order from `almanacScroll`. */
export function almanacRowRects(count: number): Rect[] {
  return Array.from({ length: visibleRows(count) }, (_unused, i) => ({
    x: ALMANAC.listX,
    y: ALMANAC.listTop + i * ALMANAC.rowPitch,
    width: ALMANAC.rowWidth,
    height: ALMANAC.rowHeight,
  }));
}

// ---- What the pointer answers ------------------------------------------------

/**
 * The boxes of `state`'s vertical menu, in menu order. On `almanac` these are
 * the visible entry rows, at most `ALMANAC_ROWS` of them, counted from
 * `almanacScroll`. `howto` and `chest` show no menu and report the one box
 * their way out is taken in; `playing` reports none.
 */
export function menuRects(state: WickState): Rect[] {
  switch (state.screen) {
    case "title":
      return titleRects();
    case "howto":
      return howtoRects();
    case "almanac":
      return almanacRowRects(almanacEntries(state.almanacTab).length);
    case "levelup":
      return [...levelUpLayout(state.run.offers.length).offers];
    case "chest":
      return chestRects();
    case "paused":
      return pauseRects();
    case "fallen":
    case "dawn":
      return endRects();
    default:
      return [];
  }
}

/** The boxes of the almanac's tab bar; every other screen reports none. */
export function tabRects(state: WickState): Rect[] {
  return state.screen === "almanac" ? almanacTabRects() : [];
}

/**
 * The `menuIndex` of the item `(x, y)` falls in, or `null`. On `almanac` the
 * box at position `i` belongs to the entry at `almanacScroll + i`, because the
 * list shows a window of at most `ALMANAC_ROWS` rows.
 */
export function itemAt(state: WickState, x: number, y: number): number | null {
  const index = menuRects(state).findIndex((rect) => contains(rect, x, y));
  if (index < 0) return null;
  return state.screen === "almanac" ? state.almanacScroll + index : index;
}

/** The tab `(x, y)` falls in on `almanac`, or `null`. */
export function tabAt(state: WickState, x: number, y: number): number | null {
  const index = tabRects(state).findIndex((rect) => contains(rect, x, y));
  return index < 0 ? null : index;
}
