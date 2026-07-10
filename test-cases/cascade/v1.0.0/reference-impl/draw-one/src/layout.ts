// Cascade — table geometry: pile rectangles, column card positions (with the
// long-column compression from specs/layout.md), the waste fan, and the clickable
// rects for the title menu and the in-game HUD.

import {
  CARD_H,
  CARD_W,
  COLS_X,
  COLUMN_BOTTOM_LIMIT,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  STOCK_X,
  TABLEAU_Y,
  TOP_Y,
  WASTE_FAN,
  WASTE_FAN_MAX,
  WASTE_X,
} from "./constants";
import type { Card, Rect } from "./types";

export function cardRect(x: number, y: number): Rect {
  return { x, y, w: CARD_W, h: CARD_H };
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

// Area of the intersection of two rectangles (0 if they do not overlap).
export function intersectArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

// ---- Top row -----------------------------------------------------------

export function stockRect(): Rect {
  return cardRect(STOCK_X, TOP_Y);
}

export function foundationRect(index: number): Rect {
  return cardRect(FOUNDATION_X[index], TOP_Y);
}

// How many waste cards are shown at the waste position. Draw One shows a single
// top card (WASTE_FAN_MAX = 1) squared over any prior cards, so this is 0 or 1.
export function wasteFanCount(wasteLen: number): number {
  return Math.min(WASTE_FAN_MAX, wasteLen);
}

// The x of the i-th visible waste card (0 = back-most of the fan).
export function wasteCardX(i: number): number {
  return WASTE_X + i * WASTE_FAN;
}

// The rect of the playable top waste card, given the current waste length.
export function wasteTopRect(wasteLen: number): Rect {
  const count = wasteFanCount(wasteLen);
  const i = Math.max(0, count - 1);
  return cardRect(wasteCardX(i), TOP_Y);
}

// ---- Tableau -----------------------------------------------------------

// The per-column face-up overlap, compressed uniformly (down to a floor of
// FACE_UP_OFFSET_MIN) so the column's lowest card edge stays above
// COLUMN_BOTTOM_LIMIT. Face-down overlap is never compressed.
export function faceUpOffset(col: Card[]): number {
  if (col.length < 2) return FACE_UP_OFFSET;
  let downGaps = 0;
  let upGaps = 0;
  for (let i = 1; i < col.length; i++) {
    if (col[i - 1].faceUp) upGaps++;
    else downGaps++;
  }
  if (upGaps === 0) return FACE_UP_OFFSET;
  // Available vertical span for the up-gaps once the fixed down-gaps and the
  // final card's own height are subtracted.
  const span = COLUMN_BOTTOM_LIMIT - TABLEAU_Y - CARD_H - downGaps * FACE_DOWN_OFFSET;
  const maxOffset = span / upGaps;
  let off = Math.min(FACE_UP_OFFSET, maxOffset);
  if (off < FACE_UP_OFFSET_MIN) off = FACE_UP_OFFSET_MIN;
  return off;
}

// The y of every card in a tableau column, top-to-bottom, using the compressed
// offset above.
export function columnCardYs(col: Card[]): number[] {
  const off = faceUpOffset(col);
  const ys: number[] = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < col.length; i++) {
    ys.push(y);
    y += col[i].faceUp ? off : FACE_DOWN_OFFSET;
  }
  return ys;
}

// The rect of a tableau column's drop target: the bottom card's footprint, or
// the empty slot at the anchor when the column is empty.
export function tableauDropRect(col: number, cards: Card[]): Rect {
  if (cards.length === 0) return cardRect(COLS_X[col], TABLEAU_Y);
  const ys = columnCardYs(cards);
  return cardRect(COLS_X[col], ys[ys.length - 1]);
}

// ---- Title menu --------------------------------------------------------

export interface MenuItem {
  label: string;
  cx: number;
  cy: number;
  rect: Rect;
}

// The two title-screen menu items (see specs/flow.md). Centered on the stage.
export function titleMenu(): MenuItem[] {
  const items = [
    { label: "NEW GAME", cx: 640, cy: 474 },
    { label: "HOW TO PLAY", cx: 640, cy: 534 },
  ];
  return items.map((it) => ({
    ...it,
    rect: { x: it.cx - 220, y: it.cy - 26, w: 440, h: 52 },
  }));
}

// ---- HUD ---------------------------------------------------------------

export interface HudLayout {
  newGame: Rect;
  menu: Rect;
  modeLabel: { cx: number; cy: number };
}

// The bottom-edge HUD (specs/flow.md): a NEW GAME control on the left, a dim mode
// label in the center, a MENU control on the right — all clear of the piles.
export function hudLayout(): HudLayout {
  const y = 670;
  const h = 40;
  return {
    newGame: { x: 415, y, w: 165, h },
    menu: { x: 760, y, w: 105, h },
    modeLabel: { cx: 640, cy: y + h / 2 },
  };
}
