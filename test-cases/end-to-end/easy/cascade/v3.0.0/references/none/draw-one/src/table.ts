// Cascade — the geometry of the table (`specs/table.md`).
//
// Where each of the thirteen piles sits, how a column's cards are fanned and
// compressed, and the one rectangle each pile answers a release in. Every
// function here is a pure read of a card list, so the drawing
// (`src/render.ts`), the pointer (`src/controls.ts`) and the tests all resolve
// against exactly the same figures.

import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  HUD_H,
  HUD_Y,
  STAGE_W,
  STOCK_X,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
} from "./constants";
import type { Card, PileName, Rect } from "./types";
import { pointInRect } from "./types";

/** The card-sized rectangle whose top-left is `(x, y)`. */
export function cardRect(x: number, y: number): Rect {
  return { x, y, w: CARD_W, h: CARD_H };
}

/** The stock's anchor, which is also the whole of its drop rectangle. */
export function stockRect(): Rect {
  return cardRect(STOCK_X, TOP_ROW_Y);
}

/** The waste's anchor, whatever the shown set holds. */
export function wasteRect(): Rect {
  return cardRect(WASTE_X, TOP_ROW_Y);
}

/** Foundation `index`'s anchor. */
export function foundationRect(index: number): Rect {
  return cardRect(FOUNDATION_X[index], TOP_ROW_Y);
}

/** The HUD strip, which holds no pile. */
export function hudStrip(): Rect {
  return { x: 0, y: HUD_Y, w: STAGE_W, h: HUD_H };
}

/**
 * The face-up overlap a column draws at.
 *
 * A column's lowest card's bottom edge may not fall below
 * `COLUMN_BOTTOM_LIMIT`. When the natural offsets would pass that line, the
 * face-up offset is reduced UNIFORMLY — the same value under every face-up card
 * of that column — to the largest value that fits, and never below
 * `FACE_UP_OFFSET_MIN`. The face-down offset is never compressed.
 *
 * The fit is made per column and per frame, so a column that compressed and
 * then lost cards draws the full offset again.
 */
export function faceUpOffset(column: readonly Card[]): number {
  if (column.length < 2) return FACE_UP_OFFSET;
  let faceUpGaps = 0;
  let faceDownGaps = 0;
  for (let i = 1; i < column.length; i += 1) {
    if (column[i - 1].faceUp) faceUpGaps += 1;
    else faceDownGaps += 1;
  }
  if (faceUpGaps === 0) return FACE_UP_OFFSET;
  // What is left for the face-up gaps once the fixed face-down gaps and the
  // lowest card's own height are taken out of the column's allowance.
  const span =
    COLUMN_BOTTOM_LIMIT - TABLEAU_Y - CARD_H - faceDownGaps * FACE_DOWN_OFFSET;
  const largest = span / faceUpGaps;
  if (largest >= FACE_UP_OFFSET) return FACE_UP_OFFSET;
  return Math.max(largest, FACE_UP_OFFSET_MIN);
}

/** The top edge of every card in a column, from its bottom card down the table. */
export function columnCardYs(column: readonly Card[]): number[] {
  const offset = faceUpOffset(column);
  const ys: number[] = [];
  let y = TABLEAU_Y;
  for (const card of column) {
    ys.push(y);
    y += card.faceUp ? offset : FACE_DOWN_OFFSET;
  }
  return ys;
}

/** The footprint of the card at `row` in `column`. */
export function columnCardRect(
  index: number,
  column: readonly Card[],
  row: number,
): Rect {
  return cardRect(COLUMN_X[index], columnCardYs(column)[row]);
}

/**
 * The rectangle a column answers a release in: the card footprint at its anchor
 * while it is empty, and otherwise `CARD_W` wide from `TABLEAU_Y` down to the
 * bottom edge of the column's lowest drawn card.
 */
export function columnDropRect(index: number, column: readonly Card[]): Rect {
  if (column.length === 0) return cardRect(COLUMN_X[index], TABLEAU_Y);
  const ys = columnCardYs(column);
  const bottom = ys[ys.length - 1] + CARD_H;
  return { x: COLUMN_X[index], y: TABLEAU_Y, w: CARD_W, h: bottom - TABLEAU_Y };
}

/** One pile and the rectangle it answers a release in. */
export interface DropZone {
  pile: PileName;
  index: number;
  rect: Rect;
}

/** Every pile's drop rectangle, in the order `specs/table.md` lists them. */
export function dropZones(
  foundations: readonly (readonly Card[])[],
  tableau: readonly (readonly Card[])[],
): DropZone[] {
  const zones: DropZone[] = [
    { pile: "stock", index: 0, rect: stockRect() },
    { pile: "waste", index: 0, rect: wasteRect() },
  ];
  for (let i = 0; i < foundations.length; i += 1) {
    zones.push({ pile: "foundation", index: i, rect: foundationRect(i) });
  }
  for (let i = 0; i < tableau.length; i += 1) {
    zones.push({
      pile: "tableau",
      index: i,
      rect: columnDropRect(i, tableau[i]),
    });
  }
  return zones;
}

/**
 * The pile whose drop rectangle contains `(x, y)`, or `null` when the point
 * lies on no pile.
 *
 * The rectangles do not overlap — the top row ends at `y = 164` and the columns
 * begin at `y = 180` — so a point lies in at most one of them and this is
 * total.
 */
export function zoneAt(
  x: number,
  y: number,
  foundations: readonly (readonly Card[])[],
  tableau: readonly (readonly Card[])[],
): DropZone | null {
  for (const zone of dropZones(foundations, tableau)) {
    if (pointInRect(x, y, zone.rect)) return zone;
  }
  return null;
}
