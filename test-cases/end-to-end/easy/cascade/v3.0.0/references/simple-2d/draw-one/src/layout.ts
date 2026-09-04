// Cascade — the geometry of the table (specs/table.md).
//
// Where every pile sits, how a column fans and compresses, which rectangle each
// pile answers a release in, and what a point on the stage lands on. Every
// position is a card's top-left in the stage's logical units, and every figure
// comes from `src/constants.ts`.

import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  STOCK_X,
  TABLEAU_Y,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
  TOP_ROW_Y,
  WASTE_X,
  type Rect,
} from "./constants";
import { pileCards, shownWasteCount } from "./piles";
import type { CardRef, PileRef } from "./piles";
import type { CardState, CascadeState, PileKind, Screen } from "./game";

/** A point on the stage, in logical units. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Whether a point lies inside a rectangle, its top and left edges included. */
export function pointIn(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** A card-sized rectangle at a top-left. */
export function cardRect(x: number, y: number): Rect {
  return { x, y, w: CARD_W, h: CARD_H };
}

/** The anchor of one of the thirteen piles: the top-left its cards square to. */
export function pileAnchor(pile: PileKind, index: number): Point {
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

/**
 * The gap drawn under each face-up card of a column.
 *
 * The natural `34` while the column fits above `COLUMN_BOTTOM_LIMIT`, and
 * otherwise the largest uniform value that does fit, never below
 * `FACE_UP_OFFSET_MIN`. The face-down gap stays at `24` however far a column is
 * compressed, and the fit is made afresh from the cards a column holds, so a
 * column that lost cards draws the full offset again.
 */
export function faceUpGap(cards: readonly CardState[]): number {
  const gaps = cards.length - 1;
  if (gaps <= 0) return FACE_UP_OFFSET;

  let faceUp = 0;
  let faceDown = 0;
  for (let i = 0; i < gaps; i++) {
    if (cards[i].faceUp) faceUp++;
    else faceDown++;
  }
  if (faceUp === 0) return FACE_UP_OFFSET;

  const natural =
    TABLEAU_Y + faceDown * FACE_DOWN_OFFSET + faceUp * FACE_UP_OFFSET + CARD_H;
  if (natural <= COLUMN_BOTTOM_LIMIT) return FACE_UP_OFFSET;

  const fits =
    (COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - faceDown * FACE_DOWN_OFFSET) /
    faceUp;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, fits));
}

/** The top edge of every card in a column, from its first card down. */
export function columnCardTops(cards: readonly CardState[]): readonly number[] {
  const gap = faceUpGap(cards);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < cards.length; i++) {
    tops.push(y);
    y += cards[i].faceUp ? gap : FACE_DOWN_OFFSET;
  }
  return tops;
}

/** The top-left a card is drawn at, from its pile and its row in that pile. */
export function cardTopLeft(
  state: CascadeState,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  const anchor = pileAnchor(pile, index);
  if (pile !== "tableau") return anchor;
  const tops = columnCardTops(pileCards(state, pile, index));
  return { x: anchor.x, y: tops[row] ?? anchor.y };
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(cards: readonly CardState[]): number {
  const tops = columnCardTops(cards);
  const last = tops.length === 0 ? TABLEAU_Y : tops[tops.length - 1];
  return last + CARD_H;
}

/**
 * The rectangle a pile answers a release in (specs/table.md).
 *
 * Every pile but a column holding cards answers a single card footprint at its
 * anchor; a column holding cards answers the whole extent it draws.
 */
export function dropRect(
  state: CascadeState,
  pile: PileKind,
  index: number,
): Rect {
  const anchor = pileAnchor(pile, index);
  if (pile !== "tableau") return cardRect(anchor.x, anchor.y);
  const cards = pileCards(state, pile, index);
  if (cards.length === 0) return cardRect(anchor.x, anchor.y);
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: columnBottom(cards) - TABLEAU_Y,
  };
}

/** Every pile, in the order a release is resolved against them. */
export function allPiles(): readonly PileRef[] {
  return [
    { pile: "stock", index: 0 },
    { pile: "waste", index: 0 },
    ...FOUNDATION_X.map((_, index) => ({ pile: "foundation" as const, index })),
    ...COLUMN_X.map((_, index) => ({ pile: "tableau" as const, index })),
  ];
}

/**
 * The pile whose drop rectangle holds the point, or `null` when none does.
 *
 * The thirteen rectangles do not overlap, so at most one can answer.
 */
export function pileAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): PileRef | null {
  for (const ref of allPiles()) {
    if (pointIn(dropRect(state, ref.pile, ref.index), x, y)) return ref;
  }
  return null;
}

/**
 * The card drawn over every other card at that point, or `null` for a point on
 * no card.
 *
 * In a column that is the lowest of the cards whose footprint holds the point.
 * The stock is deliberately absent: it draws its top card, but a press on it
 * lifts nothing, so it never resolves to a card.
 */
export function cardAtPoint(
  state: CascadeState,
  x: number,
  y: number,
): CardRef | null {
  if (pointIn(cardRect(WASTE_X, TOP_ROW_Y), x, y)) {
    const shown = shownWasteCount(state);
    if (shown <= 0) return null;
    return { pile: "waste", index: 0, row: state.waste.length - 1 };
  }

  for (let i = 0; i < state.foundations.length; i++) {
    if (!pointIn(cardRect(FOUNDATION_X[i], TOP_ROW_Y), x, y)) continue;
    const pile = state.foundations[i];
    if (pile.length === 0) return null;
    return { pile: "foundation", index: i, row: pile.length - 1 };
  }

  for (let i = 0; i < state.tableau.length; i++) {
    const cards = state.tableau[i];
    if (cards.length === 0) continue;
    const tops = columnCardTops(cards);
    for (let row = cards.length - 1; row >= 0; row--) {
      if (pointIn(cardRect(COLUMN_X[i], tops[row]), x, y)) {
        return { pile: "tableau", index: i, row };
      }
    }
  }

  return null;
}

// ---- The controls (specs/controls.md) ------------------------------------

/** Every control the pointer answers, named by what it does. */
export type ControlId =
  | "title-new-game"
  | "title-how-to"
  | "howto-back"
  | "hud-new-game"
  | "hud-menu"
  | "hud-sound";

const CONTROLS: readonly {
  readonly id: ControlId;
  readonly screen: Screen;
  readonly rect: Rect;
}[] = [
  { id: "title-new-game", screen: "title", rect: TITLE_NEW_GAME },
  { id: "title-how-to", screen: "title", rect: TITLE_HOW_TO },
  { id: "howto-back", screen: "howto", rect: HOWTO_BACK },
  { id: "hud-new-game", screen: "playing", rect: HUD_NEW_GAME },
  { id: "hud-menu", screen: "playing", rect: HUD_MENU },
  { id: "hud-sound", screen: "playing", rect: HUD_SOUND },
];

/** The control whose rectangle holds the point on that screen, or `null`. */
export function controlAtPoint(
  screen: Screen,
  x: number,
  y: number,
): ControlId | null {
  for (const control of CONTROLS) {
    if (control.screen === screen && pointIn(control.rect, x, y)) {
      return control.id;
    }
  }
  return null;
}

/** The center of a card drawn at a top-left, which a drop resolves against. */
export function cardCenter(x: number, y: number): Point {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}
