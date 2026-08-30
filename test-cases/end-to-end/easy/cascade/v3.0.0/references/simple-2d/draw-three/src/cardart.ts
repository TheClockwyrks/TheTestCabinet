// Cascade — how a card is drawn.
//
// `specs/overview.md` fixes what a player must READ at a glance and leaves the
// look to this build, so this module answers the legibility table row by row: a
// face shows its rank and its suit, the two suit colours are far apart, a back
// reads apart from a face and from the felt, and an empty slot reads apart from
// the bare table.
//
// A suit is drawn as a SHAPE rather than as a glyph, three times on a face: a
// small pip under the rank in each of the two corners, and a large one in the
// middle. A shape carries the suit and its colour identically on every host,
// where a glyph carries them only where a font happened to have one, and a card
// index that renders as a missing-glyph box on a headless canvas is a card that
// does not say what it is.
//
// Everything here draws through `Ctx2D`, the surface the frame's canvas and the
// painted layer share, so a card stamped onto the trail is the same drawing as a
// card in flight.

import { CARD_H, CARD_W } from "./constants";
import { cardColor, rankLabel } from "./cards";
import { COLOR, font } from "./theme";
import type { Suit } from "./game";
import type { Ctx2D } from "./trail";

/** The colour a suit's rank, glyph and pip are drawn in. */
export function suitColor(suit: Suit): string {
  return cardColor(suit) === "red" ? COLOR.suitRed : COLOR.suitBlack;
}

/** A heart, centred on `(cx, cy)` and `size` across. */
function heartPath(ctx: Ctx2D, cx: number, cy: number, size: number): void {
  const w = size / 2;
  const h = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + h);
  ctx.bezierCurveTo(
    cx - w * 1.5,
    cy - h * 0.2,
    cx - w * 0.5,
    cy - h * 1.3,
    cx,
    cy - h * 0.4,
  );
  ctx.bezierCurveTo(
    cx + w * 0.5,
    cy - h * 1.3,
    cx + w * 1.5,
    cy - h * 0.2,
    cx,
    cy + h,
  );
  ctx.closePath();
}

/** A diamond, centred on `(cx, cy)` and `size` across. */
function diamondPath(ctx: Ctx2D, cx: number, cy: number, size: number): void {
  const w = size * 0.42;
  const h = size * 0.56;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.lineTo(cx + w, cy);
  ctx.lineTo(cx, cy + h);
  ctx.lineTo(cx - w, cy);
  ctx.closePath();
}

/** A spade, centred on `(cx, cy)` and `size` across. */
function spadePath(ctx: Ctx2D, cx: number, cy: number, size: number): void {
  const w = size / 2;
  const h = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h);
  ctx.bezierCurveTo(
    cx + w * 0.5,
    cy - h * 0.2,
    cx + w * 1.4,
    cy + h * 0.3,
    cx,
    cy + h * 0.5,
  );
  ctx.bezierCurveTo(
    cx - w * 1.4,
    cy + h * 0.3,
    cx - w * 0.5,
    cy - h * 0.2,
    cx,
    cy - h,
  );
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.34, cy + h);
  ctx.quadraticCurveTo(cx, cy + h * 0.75, cx, cy + h * 0.4);
  ctx.quadraticCurveTo(cx, cy + h * 0.75, cx + w * 0.34, cy + h);
  ctx.closePath();
}

/** A club, centred on `(cx, cy)` and `size` across. */
function clubPath(ctx: Ctx2D, cx: number, cy: number, size: number): void {
  const r = size * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.1, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - r * 1.05, cy + r * 0.5, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + r * 1.05, cy + r * 0.5, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy + size * 0.5);
  ctx.quadraticCurveTo(cx, cy + r * 0.6, cx, cy + r * 0.2);
  ctx.quadraticCurveTo(cx, cy + r * 0.6, cx + r * 0.7, cy + size * 0.5);
  ctx.closePath();
}

/** One suit pip, filled in its own colour. */
export function drawPip(
  ctx: Ctx2D,
  suit: Suit,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.fillStyle = suitColor(suit);
  switch (suit) {
    case "hearts":
      heartPath(ctx, cx, cy, size);
      break;
    case "diamonds":
      diamondPath(ctx, cx, cy, size);
      break;
    case "spades":
      spadePath(ctx, cx, cy, size);
      break;
    case "clubs":
      clubPath(ctx, cx, cy, size);
      break;
  }
  ctx.fill();
}

/** The card-shaped plate every card, face-up or face-down, is drawn on. */
function drawPlate(ctx: Ctx2D, x: number, y: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.cardEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2);
}

/** A face-up card: its rank and its suit, drawn on its paper. */
export function drawCardFace(
  ctx: Ctx2D,
  x: number,
  y: number,
  suit: Suit,
  rank: number,
): void {
  drawPlate(ctx, x, y, COLOR.cardFace);

  const label = rankLabel(rank);
  ctx.fillStyle = suitColor(suit);

  ctx.font = font(22, "bold");
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 10, y + 8);
  drawPip(ctx, suit, x + 18, y + 45, 17);

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x + CARD_W - 10, y + CARD_H - 8);
  drawPip(ctx, suit, x + CARD_W - 18, y + CARD_H - 45, 17);

  drawPip(ctx, suit, x + CARD_W / 2, y + CARD_H / 2 + 4, 46);
}

/** A face-down card: its back, and nothing of what it is. */
export function drawCardBack(ctx: Ctx2D, x: number, y: number): void {
  drawPlate(ctx, x, y, COLOR.cardBack);
  ctx.fillStyle = COLOR.cardBackPattern;
  const step = 14;
  for (let row = y + 14; row < y + CARD_H - 12; row += step) {
    for (let col = x + 13; col < x + CARD_W - 10; col += step) {
      const size = 5;
      ctx.beginPath();
      ctx.moveTo(col, row - size);
      ctx.lineTo(col + size, row);
      ctx.lineTo(col, row + size);
      ctx.lineTo(col - size, row);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.strokeStyle = COLOR.cardBackPattern;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 7, y + 7, CARD_W - 14, CARD_H - 14);
}

/** One card, drawn as its face shows. */
export function drawCard(
  ctx: Ctx2D,
  x: number,
  y: number,
  card: {
    readonly suit: Suit;
    readonly rank: number;
    readonly faceUp: boolean;
  },
): void {
  if (card.faceUp) drawCardFace(ctx, x, y, card.suit, card.rank);
  else drawCardBack(ctx, x, y);
}

/** The card-sized mark a pile holding no cards draws at its anchor. */
export function drawEmptySlot(ctx: Ctx2D, x: number, y: number): void {
  ctx.fillStyle = COLOR.slot;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.slotLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 3, y + 3, CARD_W - 6, CARD_H - 6);
}
