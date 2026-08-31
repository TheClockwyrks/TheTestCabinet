// Facet — the rectangles the pointer operates a screen through.
//
// `specs/controls.md` gives every screen a set of pointer targets and makes the
// hit test part of the game: which target a position lies in decides what a
// press arms and what a release takes, exactly as which cell a position lies on
// decides what a press selects. So the geometry lives in the core beside the
// rules rather than in a renderer, and the renderer draws what this module
// says. Two independent sets of numbers would satisfy "a `menu-<i>` target
// covers the drawn item it names" only until one of them was edited.
//
// EVERY NUMBER BELOW IS THIS BUILD'S LAYOUT CHOICE, not a figure the
// specification fixes. What the specification fixes is the ids, their order,
// and the four requirements the rectangles satisfy: at least `TARGET_MIN_W` by
// `TARGET_MIN_H`, wholly on the stage, no two on a screen overlapping, and on
// `playing` the `pause` control wholly clear of the board's drawn extent. The
// menus are stacked and centered on the stage's vertical axis with a row gap
// wider than a target is tall, which is what keeps two neighbors apart; the
// `back` control sits low under the text it lets a player leave; and the
// `pause` control sits in the strip to the right of the board, which the board
// never reaches.

import {
  GAMEOVER_ITEMS,
  LEVELCLEAR_ITEMS,
  PAUSED_ITEMS,
  STAGE_CX,
  TARGET_MIN_H,
  TARGET_MIN_W,
  TITLE_ITEMS,
} from "../constants";
import type { Screen } from "./state";

/** One target: its id and its rectangle, in the stage's logical units. */
export interface TargetRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---- The build's layout ---------------------------------------------------

/** Wide enough for the longest menu item this game shows, `HOW TO PLAY`. */
export const MENU_TARGET_W = 420;

/** Every target is this tall, which is the floor the specification states. */
export const MENU_TARGET_H = TARGET_MIN_H;

/** The distance between two menu rows, wider than a row is tall. */
export const MENU_ROW_GAP = 96;

/**
 * Where each menu's first row is centered. The four differ because each screen
 * carries a different amount of copy above its menu: the title screen a title
 * and a tagline, `paused` a heading alone, `levelclear` a heading and the two
 * figures the level was measured by, and `gameover` a heading and the round's
 * score.
 */
export const TITLE_MENU_CY = 420;
export const PAUSED_MENU_CY = 396;
export const LEVELCLEAR_MENU_CY = 470;
export const GAMEOVER_MENU_CY = 452;

/** The two on-screen controls, which carry one word each. */
export const CONTROL_W = 176;
export const CONTROL_H = TARGET_MIN_H;

/** How-to's way out, under the rules it explains. */
export const HOWTO_BACK_CENTER = { x: STAGE_CX, y: 656 } as const;

/**
 * The pause control, in the strip to the right of the board. Cell centers run
 * x `388..892` and a gem's drawn form reaches `GEM_R` beyond a center, so the
 * board reaches x `358..922`; this rectangle starts at `1032` and never meets
 * it, whatever row it is drawn beside.
 */
export const PLAYING_PAUSE_CENTER = { x: 1120, y: 72 } as const;

// ---- The targets themselves ----------------------------------------------

/** A target of the given size, centered on a point. */
function around(
  id: string,
  center: { readonly x: number; readonly y: number },
  w: number,
  h: number,
): TargetRect {
  return { id, x: center.x - w / 2, y: center.y - h / 2, w, h };
}

/** One `menu-<i>` target per item of a vertical menu, top to bottom. */
function menuTargets(count: number, firstCy: number): TargetRect[] {
  return Array.from({ length: count }, (_item, index) =>
    around(
      `menu-${index}`,
      { x: STAGE_CX, y: firstCy + index * MENU_ROW_GAP },
      MENU_TARGET_W,
      MENU_TARGET_H,
    ),
  );
}

/**
 * The screen's pointer targets, under the ids and in the order
 * `specs/controls.md` fixes for it. It is derived from the screen alone, which
 * is why the state stores no target and the snapshot reports these.
 */
export function targetsFor(screen: Screen): readonly TargetRect[] {
  switch (screen) {
    case "title":
      return menuTargets(TITLE_ITEMS.length, TITLE_MENU_CY);
    case "howto":
      return [around("back", HOWTO_BACK_CENTER, CONTROL_W, CONTROL_H)];
    case "playing":
      return [around("pause", PLAYING_PAUSE_CENTER, CONTROL_W, CONTROL_H)];
    case "paused":
      return menuTargets(PAUSED_ITEMS.length, PAUSED_MENU_CY);
    case "levelclear":
      return menuTargets(LEVELCLEAR_ITEMS.length, LEVELCLEAR_MENU_CY);
    case "gameover":
      return menuTargets(GAMEOVER_ITEMS.length, GAMEOVER_MENU_CY);
  }
}

/**
 * The target a stage position lies in, or `null` when it lies in none.
 *
 * No two targets on a screen overlap, so the first match is the only match. A
 * target's own edges count as inside it, so a press exactly on a border still
 * lands on the control the player aimed at.
 */
export function targetAt(
  screen: Screen,
  x: number,
  y: number,
): TargetRect | null {
  for (const target of targetsFor(screen)) {
    if (
      x >= target.x &&
      x <= target.x + target.w &&
      y >= target.y &&
      y <= target.y + target.h
    ) {
      return target;
    }
  }
  return null;
}

/** The menu index a `menu-<i>` id names, or `null` for any other id. */
export function menuIndexOf(id: string): number | null {
  const matched = /^menu-(\d+)$/.exec(id);
  return matched === null ? null : Number(matched[1]);
}

/** The floor a target is sized to, re-exported so a renderer draws to it. */
export const TARGET_MIN = { w: TARGET_MIN_W, h: TARGET_MIN_H } as const;
