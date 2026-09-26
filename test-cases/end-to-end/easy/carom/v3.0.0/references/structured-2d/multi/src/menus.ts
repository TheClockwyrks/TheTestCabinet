// Carom — the menus: what each screen offers, where it puts each item, and how
// the keyboard, a mouse, and a finger move over them.
//
// One module holds all three because they must agree. specs/ui.md drives every
// menu screen with a pointer and with touch as well as with the keyboard, over
// regions the BUILD lays out, and specs/instrumentation.md has the build REPORT
// those regions through `menuItemRect`. So the rectangles below are the single
// source of that layout: the chrome draws each item at its own rectangle
// (`src/screens.ts`), the pointer resolves a position against the same
// rectangles, and the reading returns them unchanged. Nothing measures text to
// decide a hit region, so what a check is told and what a player clicks are the
// same numbers.
//
// The geometry itself is this build's own — specs/ui.md fixes the items and
// their order, not where they are drawn — so it lives here beside the rest of
// the look rather than in the case-fixed `src/constants.ts`.

import type { PointerSample } from "@clockwyrks/structured-2d";
import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "./constants";
import type { Screen } from "./state";

/** A hit region in logical units, as `menuItemRect` reports it. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The how-to screen's single menu item (specs/ui.md, screen 2): its copy is the
 * build's, and confirming it returns to the title.
 */
export const HOWTO_ITEMS = ["BACK"] as const;

/** One menu: the items it shows, top to bottom, and where each one sits. */
export interface Menu {
  readonly items: readonly string[];
  readonly rects: readonly MenuRect[];
}

/** How a vertical menu is laid out: item centres, and the size of each region. */
interface MenuGeometry {
  /** Centre x of every item. */
  cx: number;
  /** Centre y of the first item. */
  startY: number;
  /** Distance between one item's centre and the next. */
  spacing: number;
  /** The width of each item's hit region. */
  w: number;
  /** The height of each item's hit region, kept under `spacing` so none meet. */
  h: number;
}

const TITLE_MENU: MenuGeometry = {
  cx: FIELD_CX,
  startY: 430,
  spacing: 52,
  w: 460,
  h: 46,
};

/** The how-to page's one way out, on the line the page's hint sits on. */
const HOWTO_MENU: MenuGeometry = {
  cx: FIELD_CX,
  startY: FIELD_H - 44,
  spacing: 52,
  w: 360,
  h: 46,
};

/** Both panelled menus sit on the panel their screen draws (src/screens.ts). */
const PAUSE_MENU: MenuGeometry = {
  cx: FIELD_CX,
  startY: FIELD_CY,
  spacing: 52,
  w: 400,
  h: 46,
};

const MATCHOVER_MENU: MenuGeometry = {
  cx: FIELD_CX,
  startY: FIELD_CY + 58,
  spacing: 52,
  w: 400,
  h: 46,
};

function rectsFor(geometry: MenuGeometry, count: number): MenuRect[] {
  const rects: MenuRect[] = [];
  for (let i = 0; i < count; i += 1) {
    const centreY = geometry.startY + i * geometry.spacing;
    rects.push({
      x: geometry.cx - geometry.w / 2,
      y: centreY - geometry.h / 2,
      w: geometry.w,
      h: geometry.h,
    });
  }
  return rects;
}

function menuFrom(items: readonly string[], geometry: MenuGeometry): Menu {
  return { items, rects: rectsFor(geometry, items.length) };
}

const MENUS: Readonly<Record<Screen, Menu | null>> = {
  title: menuFrom(TITLE_ITEMS, TITLE_MENU),
  howto: menuFrom(HOWTO_ITEMS, HOWTO_MENU),
  countdown: null,
  playing: null,
  paused: menuFrom(PAUSE_ITEMS, PAUSE_MENU),
  matchover: menuFrom(MATCHOVER_ITEMS, MATCHOVER_MENU),
};

/** The menu `screen` shows, or `null` on the two screens that show none. */
export function menuOf(screen: Screen): Menu | null {
  return MENUS[screen];
}

/**
 * The hit region of item `index` on the menu `screen` shows.
 *
 * `null` on `countdown` and `playing`, which show no menu, and for an index
 * that names no item of that menu (specs/instrumentation.md).
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  return menuOf(screen)?.rects[index] ?? null;
}

/** The item whose region holds `(x, y)`, or `null` for a miss. */
export function itemAtPoint(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const menu = menuOf(screen);
  if (menu === null) return null;
  const found = menu.rects.findIndex(
    (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
  );
  return found === -1 ? null : found;
}

/* ---- The pointer and the finger ------------------------------------------- */

/**
 * Which item each pointer in contact was PRESSED on, by pointer id.
 *
 * A confirm requires both of its edges inside one item's region (specs/ui.md), and
 * the two can be frames apart — a player who presses, slides off, and lifts
 * elsewhere has confirmed nothing — so where each press landed is remembered
 * until that pointer lifts. It lives on the game instance, the one framework
 * object that outlives a level, because a gesture is the player's rather than
 * any one world's.
 */
export type PressOrigins = Map<number, number | null>;

/** What one frame's pointer and touch samples asked of the current menu. */
export interface PointerMenuInput {
  /** The item a move, a landing, or a completed press named. `null` for none. */
  selected: number | null;
  /** The item a press and its release both fell inside. `null` for none. */
  confirmed: number | null;
}

/**
 * Resolve one frame's pointer samples against the menu `screen` shows.
 *
 * Every sample is taken in arrival order, so a sweep that crossed several items
 * between two frames selects the last one it was over rather than the first —
 * and a press and the release that follows it may arrive on one frame, which
 * that frame confirms (specs/ui.md).
 */
export function readPointerMenu(
  samples: readonly PointerSample[],
  screen: Screen,
  origins: PressOrigins,
): PointerMenuInput {
  let selected: number | null = null;
  let confirmed: number | null = null;

  for (const sample of samples) {
    const item = itemAtPoint(screen, sample.x, sample.y);
    if (sample.type === "down") {
      // A finger does not hover, so its landing is what selects the item.
      origins.set(sample.id, item);
      if (item !== null) selected = item;
      continue;
    }
    if (sample.type === "move") {
      if (item !== null) selected = item;
      continue;
    }
    // A release. It confirms only when the press that opened this contact fell
    // inside the same item's region; two edges in different regions, and an
    // edge outside every region, confirm no item.
    const from = origins.get(sample.id) ?? null;
    origins.delete(sample.id);
    if (item !== null && from === item) {
      selected = item;
      confirmed = item;
    }
  }

  return { selected, confirmed };
}
