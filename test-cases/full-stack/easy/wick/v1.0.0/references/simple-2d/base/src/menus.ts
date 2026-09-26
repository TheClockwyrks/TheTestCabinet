// Wick — where every menu sits on the stage (specs/ui.md, specs/controls.md
// "The pointer", specs/instrumentation.md "Menus").
//
// One definition of the rectangles, shared by the renderer that draws the
// menus and by the pointer that answers them: `src/render/screens.ts` and
// `src/render/almanac.ts` draw each item over the rectangle this module
// gives it, and `src/flow.ts` resolves a hover and a click against the same
// list, so what a click takes is always what the highlight was drawn over.
// `menuRects` and `tabRects` are the two readings the debug surface reports,
// which makes what the pointer acts on readable from outside.

import {
  ALMANAC_TABS,
  END_ITEMS,
  PAUSE_ITEMS,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TITLE_ITEMS,
} from "./constants";
import { entriesOf, visibleRows } from "./almanac";
import type { WickRect, WickState } from "./game";
import type { DeepReadonly } from "ts-essentials";

type View = DeepReadonly<WickState>;

// ---- Vertical menus --------------------------------------------------------

/** Stage units between one menu row's baseline and the next. */
const MENU_LINE = 44;

/** The rectangle a menu row covers, about that baseline. */
const MENU_ITEM_W = 360;
const MENU_ITEM_H = 36;

/** How far a row's baseline sits below the top of its rectangle. */
export const MENU_TEXT_DROP = 26;

/** The baseline of the first row of each stacked menu. */
export const TITLE_MENU_Y = 410;
export const PAUSE_MENU_Y = 390;
export const END_MENU_Y = 450;

/** The rectangles of a stacked menu of `count` rows from the baseline `y`. */
export function stackRects(y: number, count: number): WickRect[] {
  return Array.from({ length: count }, (_, i) => ({
    x: STAGE_CX - MENU_ITEM_W / 2,
    y: y + i * MENU_LINE - MENU_TEXT_DROP,
    width: MENU_ITEM_W,
    height: MENU_ITEM_H,
  }));
}

// ---- The way out of `howto` and `chest` ------------------------------------
//
// Neither shows a menu, and each answers the pointer and touch on one box:
// "the area the screen's way out is taken in, which the screen shows"
// (specs/controls.md). `src/render/screens.ts` draws its line inside that box,
// so what is clicked or tapped is what the player sees.

const DISMISS_W = 340;
const DISMISS_H = 38;

/** The baseline of the line drawn inside a dismiss box, from its top. */
export const DISMISS_TEXT_DROP = 25;

/** The tops of the two boxes: at the how-to's foot, inside the chest panel. */
export const HOWTO_DISMISS_TOP = STAGE_H - 84;
export const CHEST_DISMISS_TOP = 426;

/** A dismiss box, centered on the stage, whose top is `top`. */
function dismissRect(top: number): WickRect {
  return {
    x: STAGE_CX - DISMISS_W / 2,
    y: top,
    width: DISMISS_W,
    height: DISMISS_H,
  };
}

/** The one box on `howto`, which `back` is taken in. */
export function howtoRects(): WickRect[] {
  return [dismissRect(HOWTO_DISMISS_TOP)];
}

/** The one box on `chest`, which `confirm` is taken in. */
export function chestRects(): WickRect[] {
  return [dismissRect(CHEST_DISMISS_TOP)];
}

// ---- The level-up overlay --------------------------------------------------

/** Stage units between one offer and the next, and the row each covers. */
const OFFER_LINE = 72;
const OFFER_W = 540;
const OFFER_H = 60;

/** The panel around the heading, the offers, and the description line. */
const OFFER_CHROME = 160;
const OFFER_FIRST = 96;

/** The overlay's panel: as tall as the offers it lists, centered on the stage. */
export function levelUpPanel(offers: number): {
  top: number;
  height: number;
} {
  const height = OFFER_CHROME + offers * OFFER_LINE;
  return { top: (STAGE_H - height) / 2, height };
}

/** The baseline of the offer at `i`, inside a panel whose top is `top`. */
export function offerBaseline(top: number, i: number): number {
  return top + OFFER_FIRST + i * OFFER_LINE;
}

/** The baseline of the description line beneath a list of `offers`. */
export function descriptionBaseline(top: number, offers: number): number {
  return offerBaseline(top, offers) + 30;
}

/** The rectangles of a level-up overlay listing `offers` offers. */
export function offerRects(offers: number): WickRect[] {
  const { top } = levelUpPanel(offers);
  return Array.from({ length: offers }, (_, i) => ({
    x: STAGE_CX - OFFER_W / 2,
    y: offerBaseline(top, i) - 8,
    width: OFFER_W,
    height: OFFER_H,
  }));
}

// ---- The almanac -----------------------------------------------------------

/** The tab bar across the top: one rectangle per tab, evenly spaced. */
const TAB_Y = 128;
const TAB_W = 200;
const TAB_H = 40;
const TAB_GAP = 16;

/** The entry list down the left: `ALMANAC_ROWS` rows at this pitch. */
const ROW_X = 96;
const ROW_Y = 208;
const ROW_W = 340;
const ROW_H = 36;
const ROW_LINE = 40;

/** The rectangles of the tab bar, in `ALMANAC_TABS` order. */
export function almanacTabRects(): WickRect[] {
  const span =
    ALMANAC_TABS.length * TAB_W + (ALMANAC_TABS.length - 1) * TAB_GAP;
  const left = (STAGE_W - span) / 2;
  return ALMANAC_TABS.map((_, i) => ({
    x: left + i * (TAB_W + TAB_GAP),
    y: TAB_Y,
    width: TAB_W,
    height: TAB_H,
  }));
}

/** The rectangles of the `rows` entry rows the list shows. */
export function almanacRowRects(rows: number): WickRect[] {
  return Array.from({ length: rows }, (_, i) => ({
    x: ROW_X,
    y: ROW_Y + i * ROW_LINE,
    width: ROW_W,
    height: ROW_H,
  }));
}

// ---- What the pointer answers ----------------------------------------------

/**
 * The rectangles of the current screen's vertical menu, in menu order. The
 * almanac's are the visible entry rows, at most `ALMANAC_ROWS` of them, from
 * `almanacScroll`. `howto` and `chest` show no menu and report the one box
 * their way out is taken in; `playing` reports none.
 */
export function menuRects(state: View): WickRect[] {
  switch (state.screen) {
    case "title":
      return stackRects(TITLE_MENU_Y, TITLE_ITEMS.length);
    case "howto":
      return howtoRects();
    case "chest":
      return chestRects();
    case "almanac":
      return almanacRowRects(
        visibleRows(entriesOf(state.almanacTab).length, state.almanacScroll),
      );
    case "levelup":
      return offerRects(state.run.offers.length);
    case "paused":
      return stackRects(PAUSE_MENU_Y, PAUSE_ITEMS.length);
    case "fallen":
    case "dawn":
      return stackRects(END_MENU_Y, END_ITEMS.length);
    default:
      return [];
  }
}

/** The rectangles of the almanac's tab bar, and none on every other screen. */
export function tabRects(state: View): WickRect[] {
  return state.screen === "almanac" ? almanacTabRects() : [];
}

/** The index of the rectangle holding `(x, y)`, or `-1` where none does. */
export function hitRect(
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
