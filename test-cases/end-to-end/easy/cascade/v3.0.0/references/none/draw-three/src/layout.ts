// Cascade — the geometry of the table.
//
// specs/table.md fixes every figure this file works in: the card footprint, the
// thirteen anchors, the two column offsets and the compression that keeps a long
// column above `COLUMN_BOTTOM_LIMIT`, the waste's fan, and the rectangle each pile
// answers a release in. Nothing here decides anything; it arranges what the specs
// fix, so the drawing and the hit testing read the same arithmetic and cannot
// drift apart.
//
// Every position is a TOP-LEFT corner in the stage's logical units.

import type { Card } from "./cards";
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
  WASTE_FAN,
  WASTE_X,
  type Rect,
} from "./constants";
import type { CascadeState, PileKind, TargetKind } from "./state";
import { wasteShownCount } from "./waste";

/** Whether a point lies in a rectangle, its left and top edges included. */
export function contains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** A rectangle's center. */
export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The anchor of a pile, which is where its first card is drawn. */
export function anchorOf(
  kind: PileKind,
  index: number,
): { x: number; y: number } {
  switch (kind) {
    case "stock":
      return { x: STOCK_X, y: TOP_ROW_Y };
    case "waste":
      return { x: WASTE_X, y: TOP_ROW_Y };
    case "foundation":
      return { x: FOUNDATION_X[index], y: TOP_ROW_Y };
    case "tableau":
      return { x: COLUMN_X[index], y: TABLEAU_Y };
  }
}

/**
 * The face-up offset a column draws at.
 *
 * The natural `FACE_UP_OFFSET` until the column's lowest card's bottom edge would
 * pass `COLUMN_BOTTOM_LIMIT`, then the largest uniform offset that fits it above
 * the line, and never less than `FACE_UP_OFFSET_MIN`. The face-down offset never
 * changes. The fit is made per column and per frame, so a column that compressed
 * and then lost cards draws the full offset again.
 */
export function columnFaceUpOffset(column: readonly Card[]): number {
  if (column.length < 2) return FACE_UP_OFFSET;
  let faceDown = 0;
  let faceUp = 0;
  // Only the cards ABOVE the lowest one contribute an offset.
  for (let i = 0; i < column.length - 1; i += 1) {
    if (column[i].faceUp) faceUp += 1;
    else faceDown += 1;
  }
  if (faceUp === 0) return FACE_UP_OFFSET;
  const room = COLUMN_BOTTOM_LIMIT - TABLEAU_Y - CARD_H;
  const natural = faceDown * FACE_DOWN_OFFSET + faceUp * FACE_UP_OFFSET;
  if (natural <= room) return FACE_UP_OFFSET;
  const fitted = (room - faceDown * FACE_DOWN_OFFSET) / faceUp;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, fitted));
}

/** The top edge of every card in a column, in order, absolute on the stage. */
export function columnCardTops(column: readonly Card[]): number[] {
  const offset = columnFaceUpOffset(column);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < column.length; i += 1) {
    tops.push(y);
    y += column[i].faceUp ? offset : FACE_DOWN_OFFSET;
  }
  return tops;
}

/** The bottom edge of a column's lowest drawn card. */
export function columnBottom(column: readonly Card[]): number {
  if (column.length === 0) return TABLEAU_Y + CARD_H;
  const tops = columnCardTops(column);
  return tops[tops.length - 1] + CARD_H;
}

/** The left edge of the `index`-th card of the waste's fan. */
export function wasteFanX(index: number): number {
  return WASTE_X + index * WASTE_FAN;
}

/**
 * The rectangle a pile answers a release in (specs/table.md).
 *
 * The top row's rectangles are one card footprint each; a column holding cards
 * answers its whole drawn extent, and an empty one answers a card footprint at
 * its anchor. No two of the thirteen overlap.
 */
export function dropRect(
  state: CascadeState,
  kind: PileKind,
  index: number,
): Rect {
  const anchor = anchorOf(kind, index);
  if (kind !== "tableau") {
    return { x: anchor.x, y: anchor.y, w: CARD_W, h: CARD_H };
  }
  const column = state.tableau[index];
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: columnBottom(column) - TABLEAU_Y,
  };
}

/** Every pile the table answers a release in, in a fixed order. */
export function everyDropRect(
  state: CascadeState,
): { kind: PileKind; index: number; rect: Rect }[] {
  const rects: { kind: PileKind; index: number; rect: Rect }[] = [
    { kind: "stock", index: 0, rect: dropRect(state, "stock", 0) },
    { kind: "waste", index: 0, rect: dropRect(state, "waste", 0) },
  ];
  for (let i = 0; i < FOUNDATION_X.length; i += 1) {
    rects.push({
      kind: "foundation",
      index: i,
      rect: dropRect(state, "foundation", i),
    });
  }
  for (let i = 0; i < COLUMN_X.length; i += 1) {
    rects.push({
      kind: "tableau",
      index: i,
      rect: dropRect(state, "tableau", i),
    });
  }
  return rects;
}

/**
 * The pile whose drop rectangle contains a point, or `null` when none does.
 *
 * The rectangles do not overlap, so the answer is unambiguous and a point in none
 * of them lies on no pile (specs/table.md).
 */
export function pileAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): { kind: PileKind; index: number } | null {
  for (const entry of everyDropRect(state)) {
    if (contains(entry.rect, x, y)) {
      return { kind: entry.kind, index: entry.index };
    }
  }
  return null;
}

/** A pile a run could land on, as a target reference. */
export function asTarget(
  kind: PileKind,
  index: number,
): { pile: TargetKind; index: number } | null {
  if (kind === "foundation" || kind === "tableau") return { pile: kind, index };
  return null;
}

/** One card the press could have landed on. */
export interface CardHit {
  kind: PileKind;
  index: number;
  /** The card's row in its pile, counted from the bottom. */
  row: number;
}

/**
 * The card drawn over every other card at a point, or `null` for bare table.
 *
 * In a column that is the LOWEST of the cards whose footprint contains the point,
 * because a column fans downward and its lowest card is drawn over the rest
 * (specs/controls.md). On the waste the fanned cards are drawn over the squared
 * pile beneath them, so a point in the fan resolves to a fanned card even where
 * the anchor's own footprint reaches.
 */
export function cardAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): CardHit | null {
  for (let col = 0; col < state.tableau.length; col += 1) {
    const column = state.tableau[col];
    if (column.length === 0) continue;
    const tops = columnCardTops(column);
    for (let row = column.length - 1; row >= 0; row -= 1) {
      const rect = { x: COLUMN_X[col], y: tops[row], w: CARD_W, h: CARD_H };
      if (contains(rect, x, y)) return { kind: "tableau", index: col, row };
    }
  }

  const shown = wasteShownCount(state);
  const buried = state.waste.length - shown;
  for (let k = shown - 1; k >= 0; k -= 1) {
    const rect = { x: wasteFanX(k), y: TOP_ROW_Y, w: CARD_W, h: CARD_H };
    if (contains(rect, x, y)) {
      return { kind: "waste", index: 0, row: buried + k };
    }
  }
  if (buried > 0) {
    const rect = { x: WASTE_X, y: TOP_ROW_Y, w: CARD_W, h: CARD_H };
    if (contains(rect, x, y)) {
      return { kind: "waste", index: 0, row: buried - 1 };
    }
  }

  for (let i = 0; i < state.foundations.length; i += 1) {
    const pile = state.foundations[i];
    if (pile.length === 0) continue;
    const rect = { x: FOUNDATION_X[i], y: TOP_ROW_Y, w: CARD_W, h: CARD_H };
    if (contains(rect, x, y)) {
      return { kind: "foundation", index: i, row: pile.length - 1 };
    }
  }

  if (state.stock.length > 0) {
    const rect = { x: STOCK_X, y: TOP_ROW_Y, w: CARD_W, h: CARD_H };
    if (contains(rect, x, y)) {
      return { kind: "stock", index: 0, row: state.stock.length - 1 };
    }
  }

  return null;
}
