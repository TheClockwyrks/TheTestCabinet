// Cascade — the geometry of the table (`specs/table.md`).
//
// Every position here is a card's TOP-LEFT corner in the stage's logical units,
// which is the convention `specs/overview.md` fixes and the one the debug surface
// reports and accepts. The camera is left at rest, so world units and the
// stage's logical units coincide and nothing in this module converts anything.
//
// This module owns four questions and no others:
//
//   - where each of the thirteen piles is anchored;
//   - where each card of a pile is DRAWN, the waste's fan and a long column's
//     compression included;
//   - which rectangle each pile answers a release in;
//   - which pile, and which card, a point lies on.
//
// What a pile ACCEPTS is `src/rules.ts`; the gestures resolved against these
// rectangles are `src/pointer.ts`.

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
  TURN_COUNT,
  WASTE_FAN,
  WASTE_X,
  type Rect,
} from "./constants";
import type { CardState, CascadeState, PileKind } from "./game";
import { pileOf, validPile, wasteShown, wasteVisibleCount } from "./piles";

/** Whether a point lies inside a rectangle, each rectangle half-open at its far edges. */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** The centre of a card whose top-left is `(x, y)`. */
export function cardCenter(x: number, y: number): { x: number; y: number } {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The anchor of one of the thirteen piles, or `null` for a name outside them. */
export function pileAnchor(
  pile: PileKind,
  index: number,
): { x: number; y: number } | null {
  if (!validPile(pile, index)) return null;
  switch (pile) {
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

// ---- A column's fan, and its compression ---------------------------------

/**
 * The face-up offset this column draws with.
 *
 * A column's lowest card's bottom edge may not fall below `COLUMN_BOTTOM_LIMIT`.
 * When the natural offsets would pass that line, the FACE-UP offset alone is
 * reduced, uniformly, to the largest value that fits the column above it, and it
 * never falls below `FACE_UP_OFFSET_MIN`. The face-down offset stays at
 * `FACE_DOWN_OFFSET` however far a column is compressed.
 *
 * The fit is made per column and per frame, so a column that compressed and then
 * lost cards draws the full offset again.
 */
export function faceUpOffsetOf(cards: readonly CardState[]): number {
  if (cards.length < 2) return FACE_UP_OFFSET;

  let faceUp = 0;
  let faceDown = 0;
  // Only the cards ABOVE the lowest contribute an offset.
  for (let i = 0; i < cards.length - 1; i += 1) {
    if (cards[i].faceUp) faceUp += 1;
    else faceDown += 1;
  }
  if (faceUp === 0) return FACE_UP_OFFSET;

  const room = COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y;
  const natural = faceDown * FACE_DOWN_OFFSET + faceUp * FACE_UP_OFFSET;
  if (natural <= room) return FACE_UP_OFFSET;

  const fitted = (room - faceDown * FACE_DOWN_OFFSET) / faceUp;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, fitted));
}

/** The top edge of each card of a column, in order, fanned downward from `TABLEAU_Y`. */
export function columnCardYs(cards: readonly CardState[]): number[] {
  const step = faceUpOffsetOf(cards);
  const ys: number[] = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < cards.length; i += 1) {
    ys.push(y);
    y += cards[i].faceUp ? step : FACE_DOWN_OFFSET;
  }
  return ys;
}

/** The bottom edge of a column's lowest drawn card, which an empty column reads at its slot. */
export function columnBottom(cards: readonly CardState[]): number {
  const ys = columnCardYs(cards);
  const last = ys.length === 0 ? TABLEAU_Y : ys[ys.length - 1];
  return last + CARD_H;
}

// ---- The waste's fan ------------------------------------------------------

/**
 * Where each card the waste SHOWS is drawn, oldest first.
 *
 * The shown cards fan to the right from the waste anchor at a pitch of
 * `WASTE_FAN`, and at most `TURN_COUNT` of them fan, so the fan begins at the
 * anchor and its right edge stays clear of the first foundation. Any shown card
 * beyond that, and every card the waste holds but does not show, is squared away
 * at the anchor beneath them.
 */
export function wasteFanXs(shownCount: number): number[] {
  const fanned = Math.min(shownCount, TURN_COUNT);
  const squared = Math.max(0, shownCount - fanned);
  const xs: number[] = [];
  for (let i = 0; i < squared; i += 1) xs.push(WASTE_X);
  for (let i = 0; i < fanned; i += 1) xs.push(WASTE_X + i * WASTE_FAN);
  return xs;
}

// ---- What is drawn, and where ---------------------------------------------

/** One card as the table draws it, named by the pile and row it belongs to. */
export interface DrawnCard {
  card: CardState;
  pile: PileKind;
  index: number;
  /** The card's row in its pile, counted from the pile's bottom card. */
  row: number;
  x: number;
  y: number;
}

/**
 * Every card the table draws, in the order it draws them, so the LAST entry
 * containing a point is the card drawn over every other card there.
 *
 * The stock and the foundations are squared piles and show their top card alone;
 * the waste shows the cards on the set it is showing, over one squared card
 * standing for everything beneath them; a column draws every card it holds. A
 * waste whose set memory is empty shows no card at all, whatever it holds.
 */
export function drawnCards(state: CascadeState): DrawnCard[] {
  const drawn: DrawnCard[] = [];

  const stockTop = state.stock.length - 1;
  if (stockTop >= 0) {
    drawn.push({
      card: state.stock[stockTop],
      pile: "stock",
      index: 0,
      row: stockTop,
      x: STOCK_X,
      y: TOP_ROW_Y,
    });
  }

  if (wasteVisibleCount(state) > 0) {
    const shown = wasteShown(state);
    const hidden = state.waste.length - shown.length;
    if (hidden > 0) {
      drawn.push({
        card: state.waste[hidden - 1],
        pile: "waste",
        index: 0,
        row: hidden - 1,
        x: WASTE_X,
        y: TOP_ROW_Y,
      });
    }
    const xs = wasteFanXs(shown.length);
    shown.forEach((card, i) => {
      drawn.push({
        card,
        pile: "waste",
        index: 0,
        row: hidden + i,
        x: xs[i],
        y: TOP_ROW_Y,
      });
    });
  }

  state.foundations.forEach((cards, index) => {
    const top = cards.length - 1;
    if (top < 0) return;
    drawn.push({
      card: cards[top],
      pile: "foundation",
      index,
      row: top,
      x: FOUNDATION_X[index],
      y: TOP_ROW_Y,
    });
  });

  state.tableau.forEach((cards, index) => {
    const ys = columnCardYs(cards);
    cards.forEach((card, row) => {
      drawn.push({
        card,
        pile: "tableau",
        index,
        row,
        x: COLUMN_X[index],
        y: ys[row],
      });
    });
  });

  return drawn;
}

/**
 * The card drawn over every other card at a point, which in a column is the
 * lowest of the cards whose footprint contains it (`specs/controls.md`).
 */
export function cardAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): DrawnCard | null {
  const drawn = drawnCards(state);
  for (let i = drawn.length - 1; i >= 0; i -= 1) {
    const entry = drawn[i];
    if (rectContains({ x: entry.x, y: entry.y, w: CARD_W, h: CARD_H }, x, y)) {
      return entry;
    }
  }
  return null;
}

// ---- The drop rectangles --------------------------------------------------

/**
 * The one rectangle a pile answers a release in (`specs/table.md`). The top row's
 * rectangles end above the columns' and the columns are spaced apart, so no two
 * of the thirteen overlap and a point lies in at most one of them.
 */
export function dropRect(
  state: CascadeState,
  pile: PileKind,
  index: number,
): Rect | null {
  const anchor = pileAnchor(pile, index);
  if (anchor === null) return null;
  if (pile !== "tableau") {
    return { x: anchor.x, y: anchor.y, w: CARD_W, h: CARD_H };
  }
  const cards = pileOf(state, pile, index) ?? [];
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: columnBottom(cards) - TABLEAU_Y,
  };
}

/** Every pile, in the order a point is resolved against them. */
export function pileRefs(): { pile: PileKind; index: number }[] {
  return [
    { pile: "stock" as const, index: 0 },
    { pile: "waste" as const, index: 0 },
    ...FOUNDATION_X.map((_, index) => ({ pile: "foundation" as const, index })),
    ...COLUMN_X.map((_, index) => ({ pile: "tableau" as const, index })),
  ];
}

/** The pile whose drop rectangle contains a point, or `null` for a point on no pile. */
export function pileAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): { pile: PileKind; index: number } | null {
  for (const ref of pileRefs()) {
    const rect = dropRect(state, ref.pile, ref.index);
    if (rect !== null && rectContains(rect, x, y)) return ref;
  }
  return null;
}
