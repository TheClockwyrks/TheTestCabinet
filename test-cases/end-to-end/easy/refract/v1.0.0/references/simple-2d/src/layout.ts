// Refract — where every screen puts the things a pointer aims at.
//
// One module owns the geometry, and both the renderer and the pointer read it,
// so what is drawn and what is hit-tested cannot drift apart. That is not a
// convenience: specs/controls.md requires a `menu-<i>` target to cover the drawn
// item it names, and two independent sets of numbers would satisfy that only
// until one of them was edited.
//
// The rectangles are the targets specs/controls.md fixes for each screen, in the
// order it fixes, at least TARGET_MIN_W by TARGET_MIN_H and clear of each other.
// The vertical menus space their items by a gap wider than a target, which is
// what keeps neighbours from overlapping; the select grid's tiles are already
// spaced by more than their own size; and the two on-screen controls on
// `playing` sit in the strips to the left and right of the board's extent, so a
// press on one can never be a press on a node.

import {
  CAMPAIGN_LENGTH,
  SOLVED_ITEMS,
  STAGE_CX,
  STAGE_W,
  TARGET_MIN_H,
  TARGET_MIN_W,
  TITLE_ITEMS,
} from "./constants";
import { campaignSolvedItems } from "./flow";
import type { RefractState } from "./game";

/** One target: its id and its rectangle, in the stage's logical units. */
export interface PointerTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ---- Vertical menus ------------------------------------------------------

/** A menu item's target, wide enough for the longest item this game shows. */
export const MENU_TARGET_W = 420;
/** Every target is this tall, which is the floor specs/controls.md states. */
export const MENU_TARGET_H = TARGET_MIN_H;

/** The title menu: three items stacked under the tagline. */
export const TITLE_MENU_FIRST_Y = 434;
/** Wider than a target, so two neighbouring items never overlap. */
export const TITLE_MENU_GAP = 80;
export const TITLE_MENU_SIZE = 30;

// ---- The select grid -----------------------------------------------------

export const SELECT_COLS = 6;
export const TILE_W = 96;
export const TILE_H = 82;
export const TILE_PITCH_X = 122;
export const TILE_PITCH_Y = 110;
export const GRID_TOP = 208;
export const SELECT_FIRST_X = STAGE_CX - ((SELECT_COLS - 1) * TILE_PITCH_X) / 2;

/** The center of the grid tile for the board at `index`, counted from 0. */
export function tileCenter(index: number): { x: number; y: number } {
  return {
    x: SELECT_FIRST_X + (index % SELECT_COLS) * TILE_PITCH_X,
    y: GRID_TOP + Math.floor(index / SELECT_COLS) * TILE_PITCH_Y,
  };
}

// ---- The over-the-board panel --------------------------------------------

// The panel sits in the strip to the right of the board — the largest board's
// nodes reach x 958 — so the finished board and every beam on it stay visible
// behind the screen, as both modes' solved screens require.
export const PANEL_CX = 1114;
export const PANEL_W = 300;
export const PANEL_MENU_GAP = 76;
export const PANEL_TARGET_W = PANEL_W - 32;
export const PANEL_MENU_SIZE = 19;

/** The wording of the complete screen's two choices, in the fixed order. */
export const COMPLETE_ITEMS: readonly string[] = [
  "BACK TO SELECT",
  "BACK TO TITLE",
];

/** A panel of `height`, centered on the stage; the value is its top edge. */
export function panelTop(height: number): number {
  return 360 - height / 2;
}

/** The solved screen's panel: its height, its top, and where its menu starts. */
export function solvedPanel(state: RefractState): {
  items: readonly string[];
  height: number;
  top: number;
  firstY: number;
} {
  const items =
    state.mode === "campaign"
      ? campaignSolvedItems(state.boardIndex)
      : [...SOLVED_ITEMS];
  const lead = state.mode === "campaign" ? 132 : 160;
  const menu = state.mode === "campaign" ? 110 : 134;
  const height = lead + items.length * PANEL_MENU_GAP;
  const top = panelTop(height);
  return { items, height, top, firstY: top + menu };
}

/** The complete screen's panel, laid out the same way. */
export function completePanel(): {
  items: readonly string[];
  height: number;
  top: number;
  firstY: number;
} {
  const height = 164 + COMPLETE_ITEMS.length * PANEL_MENU_GAP;
  const top = panelTop(height);
  return { items: COMPLETE_ITEMS, height, top, firstY: top + 148 };
}

// ---- The two on-screen controls ------------------------------------------

export const CONTROL_W = 160;
export const CONTROL_H = TARGET_MIN_H;

/** How-to's way out, under the rules it explains. */
export const HOWTO_BACK = { x: STAGE_CX, y: 664 };
/** The grid's way out, under the four set rows. */
export const SELECT_BACK = { x: STAGE_CX, y: 650 };
// The board's extent spans x 322..958, so these two sit outside it on either
// side and a press on one is never a press on a node.
export const PLAYING_CLEAR = { x: 100, y: 680 };
export const PLAYING_BACK = { x: STAGE_W - 100, y: 680 };

// ---- The targets themselves ----------------------------------------------

/** A target centered on a point. */
function around(
  id: string,
  center: { x: number; y: number },
  w: number,
  h: number,
): PointerTarget {
  return { id, x: center.x - w / 2, y: center.y - h / 2, w, h };
}

/** One `menu-<i>` target per item of a vertical menu. */
function menuTargets(
  count: number,
  cx: number,
  firstY: number,
  gap: number,
  w: number,
): PointerTarget[] {
  return Array.from({ length: count }, (_item, index) =>
    around(
      `menu-${index}`,
      { x: cx, y: firstY + index * gap },
      w,
      MENU_TARGET_H,
    ),
  );
}

/**
 * The current screen's targets, under the ids and in the order
 * specs/controls.md fixes for it.
 */
export function targetsFor(state: RefractState): PointerTarget[] {
  switch (state.screen) {
    case "title":
      return menuTargets(
        TITLE_ITEMS.length,
        STAGE_CX,
        TITLE_MENU_FIRST_Y,
        TITLE_MENU_GAP,
        MENU_TARGET_W,
      );
    case "howto":
      return [around("back", HOWTO_BACK, CONTROL_W, CONTROL_H)];
    case "select":
      return [
        ...Array.from({ length: CAMPAIGN_LENGTH }, (_board, index) =>
          around(`board-${index + 1}`, tileCenter(index), TILE_W, TILE_H),
        ),
        around("back", SELECT_BACK, CONTROL_W, CONTROL_H),
      ];
    case "playing":
      return [
        around("clear", PLAYING_CLEAR, CONTROL_W, CONTROL_H),
        around("back", PLAYING_BACK, CONTROL_W, CONTROL_H),
      ];
    case "solved": {
      const panel = solvedPanel(state);
      return menuTargets(
        panel.items.length,
        PANEL_CX,
        panel.firstY,
        PANEL_MENU_GAP,
        PANEL_TARGET_W,
      );
    }
    case "complete": {
      const panel = completePanel();
      return menuTargets(
        panel.items.length,
        PANEL_CX,
        panel.firstY,
        PANEL_MENU_GAP,
        PANEL_TARGET_W,
      );
    }
  }
}

/**
 * The target a stage position lies in, or `null`.
 *
 * No two targets on a screen overlap, so the first match is the only match.
 */
export function targetAt(
  state: RefractState,
  x: number,
  y: number,
): PointerTarget | null {
  for (const target of targetsFor(state)) {
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
  const match = /^menu-(\d+)$/.exec(id);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** The zero-based board a `board-<n>` id names, or `null` for any other id. */
export function boardIndexOf(id: string): number | null {
  const match = /^board-(\d+)$/.exec(id);
  return match?.[1] === undefined ? null : Number(match[1]) - 1;
}

/** The smallest a target may be, re-exported so the renderer sizes to it. */
export const TARGET_MIN = { w: TARGET_MIN_W, h: TARGET_MIN_H } as const;
