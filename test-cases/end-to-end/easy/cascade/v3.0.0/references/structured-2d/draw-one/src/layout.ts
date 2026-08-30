// Cascade — the geometry of the table (specs/table.md).
//
// Everything here is arithmetic over the figures `src/constants.ts` fixes and
// the cards a pile holds: where each of the thirteen piles sits, how a column
// fans and compresses, what rectangle each pile answers a release in, and which
// pile a point lies on. Nothing here draws and nothing here changes the game.
//
// A position is always a card's TOP-LEFT corner in the stage's logical units,
// which is the convention `specs/overview.md` fixes for the whole build.

import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
  type Rect,
} from "./constants";
import type { CardState, CascadeState, PileKind } from "./game";

/** A pile of the table, named the way the debug surface names one. */
export interface PileRef {
  pile: PileKind;
  index: number;
}

/** Whether a point lies inside a rectangle, its left and top edges included. */
export function inRect(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** The anchor of one of the thirteen piles: the top-left its cards sit at. */
export function pileAnchor(pile: PileKind, index: number): [number, number] {
  switch (pile) {
    case "stock":
      return [STOCK_X, TOP_ROW_Y];
    case "waste":
      return [WASTE_X, TOP_ROW_Y];
    case "foundation":
      return [FOUNDATION_X[index], TOP_ROW_Y];
    case "tableau":
      return [COLUMN_X[index], TABLEAU_Y];
  }
}

/**
 * The face-up offset a column draws at.
 *
 * `FACE_UP_OFFSET` until the column's lowest card would pass
 * `COLUMN_BOTTOM_LIMIT`, then the largest uniform value that fits it above the
 * line, and never below `FACE_UP_OFFSET_MIN`. The face-down offset never
 * changes. The fit is made from the column as it stands, so a column that lost
 * cards draws the full offset again on the very next frame (specs/table.md).
 */
export function faceUpOffsetFor(column: readonly CardState[]): number {
  let faceUpGaps = 0;
  let faceDownGaps = 0;
  for (let i = 1; i < column.length; i += 1) {
    if (column[i - 1].faceUp) faceUpGaps += 1;
    else faceDownGaps += 1;
  }
  if (faceUpGaps === 0) return FACE_UP_OFFSET;

  const natural =
    TABLEAU_Y + faceDownGaps * FACE_DOWN_OFFSET + faceUpGaps * FACE_UP_OFFSET;
  if (natural + CARD_H <= COLUMN_BOTTOM_LIMIT) return FACE_UP_OFFSET;

  const room =
    COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - faceDownGaps * FACE_DOWN_OFFSET;
  return Math.max(FACE_UP_OFFSET_MIN, room / faceUpGaps);
}

/** The top edge of the card at `row` of a column, from the column's own fan. */
export function columnCardY(column: readonly CardState[], row: number): number {
  const faceUp = faceUpOffsetFor(column);
  let y = TABLEAU_Y;
  for (let i = 1; i <= row && i < column.length; i += 1) {
    y += column[i - 1].faceUp ? faceUp : FACE_DOWN_OFFSET;
  }
  return y;
}

/** The top-left of the card at `row` of column `col`. */
export function columnCardTopLeft(
  column: readonly CardState[],
  col: number,
  row: number,
): [number, number] {
  return [COLUMN_X[col], columnCardY(column, row)];
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(column: readonly CardState[]): number {
  if (column.length === 0) return TABLEAU_Y + CARD_H;
  return columnCardY(column, column.length - 1) + CARD_H;
}

/** The top-left a card is drawn at, wherever in the table it sits. */
export function cardTopLeft(
  state: CascadeState,
  pile: PileKind,
  index: number,
  row: number,
): [number, number] {
  if (pile === "tableau") {
    return columnCardTopLeft(state.tableau[index], index, row);
  }
  return pileAnchor(pile, index);
}

/**
 * How many of the waste's cards it shows: the newest set's count, and `0` when
 * the set memory is empty, whatever cards the waste still holds
 * (specs/stock.md).
 */
export function wasteVisibleCount(state: CascadeState): number {
  const sets = state.wasteSets;
  return sets.length === 0 ? 0 : sets[sets.length - 1];
}

/**
 * The cards the waste shows, bottom-most first, so the last of them is its top
 * card. Never more cards than the waste actually holds.
 */
export function wasteShownCards(state: CascadeState): CardState[] {
  const count = Math.min(wasteVisibleCount(state), state.waste.length);
  return count === 0 ? [] : state.waste.slice(state.waste.length - count);
}

/**
 * The top-left the waste's `n`th shown card is drawn at.
 *
 * Draw One shows one card, so every shown card sits squared at the waste's own
 * anchor (specs/table.md).
 */
export function wasteCardTopLeft(_shownIndex: number): [number, number] {
  return [WASTE_X, TOP_ROW_Y];
}

/** The rectangle a pile answers a release inside (specs/table.md). */
export function dropRect(
  state: CascadeState,
  pile: PileKind,
  index: number,
): Rect {
  const [x, y] = pileAnchor(pile, index);
  if (pile !== "tableau") return { x, y, w: CARD_W, h: CARD_H };
  const column = state.tableau[index];
  return { x, y, w: CARD_W, h: columnBottom(column) - TABLEAU_Y };
}

/**
 * The pile whose drop rectangle contains a point, or `null` when the point lies
 * on no pile. The thirteen rectangles do not overlap, so at most one answers.
 */
export function pileAt(
  state: CascadeState,
  x: number,
  y: number,
): PileRef | null {
  for (const pile of ["stock", "waste"] as const) {
    if (inRect(dropRect(state, pile, 0), x, y)) return { pile, index: 0 };
  }
  for (let i = 0; i < FOUNDATION_X.length; i += 1) {
    if (inRect(dropRect(state, "foundation", i), x, y)) {
      return { pile: "foundation", index: i };
    }
  }
  for (let i = 0; i < COLUMN_X.length; i += 1) {
    if (inRect(dropRect(state, "tableau", i), x, y)) {
      return { pile: "tableau", index: i };
    }
  }
  return null;
}
