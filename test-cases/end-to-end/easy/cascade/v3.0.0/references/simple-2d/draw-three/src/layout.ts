// Cascade — the geometry of the table (`specs/table.md`).
//
// One module decides where every card is drawn, and the drawing, the hit test and
// the drop resolution all read it. That is deliberate: `specs/controls.md` says a
// press resolves to "the card drawn over every other card at the press point", so
// the only way the pointer and the picture cannot disagree is for both to be
// answered from the same list of placed cards.
//
// Every position here is a card's TOP-LEFT corner in the stage's logical units,
// which is the convention `specs/overview.md` fixes.

import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_COUNT,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_COLUMNS,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_FAN,
  WASTE_X,
  type Rect,
} from "./constants";
import type { PileKind, Suit } from "./game";

/** The most cards the waste ever fans; the rest are squared away beneath them. */
export const WASTE_FAN_MAX = 3;

/** A card, as much of one as the geometry needs. */
export interface CardView {
  readonly id: number;
  readonly suit: Suit;
  readonly rank: number;
  readonly faceUp: boolean;
}

/** The thirteen piles, as much of them as the geometry needs. */
export interface BoardView {
  readonly stock: readonly CardView[];
  readonly waste: readonly CardView[];
  readonly wasteSets: readonly number[];
  readonly foundations: readonly (readonly CardView[])[];
  readonly tableau: readonly (readonly CardView[])[];
}

/** One card, placed: which pile holds it, where in that pile, and where it draws. */
export interface PlacedCard {
  readonly pile: PileKind;
  readonly index: number;
  readonly row: number;
  readonly card: CardView;
  readonly x: number;
  readonly y: number;
}

/** Whether `(x, y)` lies inside `rect`. */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
}

/** The anchor of a pile: the top-left its cards are laid out from. */
export function pileAnchor(
  pile: PileKind,
  index: number,
): { x: number; y: number } {
  switch (pile) {
    case "stock":
      return { x: STOCK_X, y: TOP_ROW_Y };
    case "waste":
      return { x: WASTE_X, y: TOP_ROW_Y };
    case "foundation":
      return { x: FOUNDATION_X[index] ?? FOUNDATION_X[0] ?? 0, y: TOP_ROW_Y };
    case "tableau":
      return { x: COLUMN_X[index] ?? COLUMN_X[0] ?? 0, y: TABLEAU_Y };
  }
}

/**
 * The face-up offset a column draws at (`specs/table.md`).
 *
 * The full `FACE_UP_OFFSET` unless the column's natural extent would carry its
 * lowest card's bottom edge past `COLUMN_BOTTOM_LIMIT`, in which case it is the
 * largest uniform value that fits, and never less than `FACE_UP_OFFSET_MIN`. The
 * face-down offset is left at `FACE_DOWN_OFFSET` however far a column compresses,
 * and the fit is made afresh every frame, so a column that lost cards expands
 * again.
 */
export function faceUpOffset(column: readonly CardView[]): number {
  let faceUpGaps = 0;
  let faceDownGaps = 0;
  for (let i = 0; i < column.length - 1; i++) {
    if ((column[i] as CardView).faceUp) faceUpGaps++;
    else faceDownGaps++;
  }
  if (faceUpGaps === 0) return FACE_UP_OFFSET;

  const room =
    COLUMN_BOTTOM_LIMIT - TABLEAU_Y - CARD_H - faceDownGaps * FACE_DOWN_OFFSET;
  const fitted = room / faceUpGaps;
  if (fitted >= FACE_UP_OFFSET) return FACE_UP_OFFSET;
  return Math.max(FACE_UP_OFFSET_MIN, fitted);
}

/** The top edge of each card of a column, top card first. */
export function columnCardTops(column: readonly CardView[]): number[] {
  const offset = faceUpOffset(column);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < column.length; i++) {
    tops.push(y);
    y += (column[i] as CardView).faceUp ? offset : FACE_DOWN_OFFSET;
  }
  return tops;
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(column: readonly CardView[]): number {
  const tops = columnCardTops(column);
  const last = tops[tops.length - 1];
  return (last ?? TABLEAU_Y) + CARD_H;
}

/**
 * How many of the waste's cards are shown (`specs/stock.md`).
 *
 * The newest set's count, held to the cards the waste actually holds, so a set
 * memory that outran its pile still shows only cards that are there.
 */
export function wasteShownCount(board: BoardView): number {
  const newest = board.wasteSets[board.wasteSets.length - 1] ?? 0;
  return Math.max(0, Math.min(newest, board.waste.length));
}

/** The left edge of the `k`th shown waste card, oldest first. */
export function wasteFanX(k: number): number {
  return WASTE_X + Math.min(k, WASTE_FAN_MAX - 1) * WASTE_FAN;
}

/**
 * Every card the table draws, in the order it is drawn.
 *
 * The last entry containing a point is the card drawn over every other card
 * there, which is exactly what `specs/controls.md` says a press resolves to.
 */
export function drawnCards(board: BoardView): PlacedCard[] {
  const placed: PlacedCard[] = [];

  // The stock and the foundations are squared piles: every card sits at the
  // anchor, so only the top card is ever seen.
  const stockTop = board.stock[board.stock.length - 1];
  if (stockTop !== undefined) {
    placed.push({
      pile: "stock",
      index: 0,
      row: board.stock.length - 1,
      card: stockTop,
      x: STOCK_X,
      y: TOP_ROW_Y,
    });
  }

  // The waste shows its newest set, fanned to the right; every other card it
  // holds is squared away at the anchor beneath them. A waste showing nothing
  // draws nothing at all, whatever it holds.
  const shown = wasteShownCount(board);
  if (shown > 0) {
    const firstShown = board.waste.length - shown;
    for (let row = 0; row < firstShown; row++) {
      placed.push({
        pile: "waste",
        index: 0,
        row,
        card: board.waste[row] as CardView,
        x: WASTE_X,
        y: TOP_ROW_Y,
      });
    }
    for (let k = 0; k < shown; k++) {
      placed.push({
        pile: "waste",
        index: 0,
        row: firstShown + k,
        card: board.waste[firstShown + k] as CardView,
        x: wasteFanX(k),
        y: TOP_ROW_Y,
      });
    }
  }

  for (let index = 0; index < FOUNDATION_COUNT; index++) {
    const pile = board.foundations[index] ?? [];
    const top = pile[pile.length - 1];
    if (top === undefined) continue;
    placed.push({
      pile: "foundation",
      index,
      row: pile.length - 1,
      card: top,
      x: pileAnchor("foundation", index).x,
      y: TOP_ROW_Y,
    });
  }

  for (let index = 0; index < TABLEAU_COLUMNS; index++) {
    const column = board.tableau[index] ?? [];
    const tops = columnCardTops(column);
    const x = pileAnchor("tableau", index).x;
    for (let row = 0; row < column.length; row++) {
      placed.push({
        pile: "tableau",
        index,
        row,
        card: column[row] as CardView,
        x,
        y: tops[row] as number,
      });
    }
  }

  return placed;
}

/** The card drawn over every other card at `(x, y)`, or `null`. */
export function cardAt(
  board: BoardView,
  x: number,
  y: number,
): PlacedCard | null {
  const placed = drawnCards(board);
  for (let i = placed.length - 1; i >= 0; i--) {
    const entry = placed[i] as PlacedCard;
    if (rectContains({ x: entry.x, y: entry.y, w: CARD_W, h: CARD_H }, x, y)) {
      return entry;
    }
  }
  return null;
}

/** One pile and the rectangle it answers a release in. */
export interface DropZone {
  readonly pile: PileKind;
  readonly index: number;
  readonly rect: Rect;
}

/**
 * The rectangle a pile answers a release in (`specs/table.md`).
 *
 * The top row's rectangles are one card each, whatever the waste's fan reaches;
 * a column's is a card's width running from the tableau anchor down to the bottom
 * edge of its lowest drawn card.
 */
export function dropRect(
  board: BoardView,
  pile: PileKind,
  index: number,
): Rect {
  const anchor = pileAnchor(pile, index);
  if (pile !== "tableau") {
    return { x: anchor.x, y: anchor.y, w: CARD_W, h: CARD_H };
  }
  const column = board.tableau[index] ?? [];
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: Math.max(CARD_H, columnBottom(column) - TABLEAU_Y),
  };
}

/** Every one of the thirteen drop rectangles. */
export function dropZones(board: BoardView): DropZone[] {
  const zones: DropZone[] = [
    { pile: "stock", index: 0, rect: dropRect(board, "stock", 0) },
    { pile: "waste", index: 0, rect: dropRect(board, "waste", 0) },
  ];
  for (let i = 0; i < FOUNDATION_COUNT; i++) {
    zones.push({
      pile: "foundation",
      index: i,
      rect: dropRect(board, "foundation", i),
    });
  }
  for (let i = 0; i < TABLEAU_COLUMNS; i++) {
    zones.push({
      pile: "tableau",
      index: i,
      rect: dropRect(board, "tableau", i),
    });
  }
  return zones;
}

/**
 * The pile whose drop rectangle contains `(x, y)`, or `null`.
 *
 * `specs/table.md` fixes the rectangles so that no two of the thirteen overlap,
 * so a point lies in at most one and the first match is the only match.
 */
export function zoneAt(
  board: BoardView,
  x: number,
  y: number,
): DropZone | null {
  for (const zone of dropZones(board)) {
    if (rectContains(zone.rect, x, y)) return zone;
  }
  return null;
}

/** The centre of the leading card of a run whose top-left is `(x, y)`. */
export function leadingCenter(x: number, y: number): { x: number; y: number } {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}
