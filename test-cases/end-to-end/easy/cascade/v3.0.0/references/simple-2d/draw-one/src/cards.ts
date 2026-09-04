// Cascade — drawing one card.
//
// A card is drawn in exactly one place, so a card in a pile, a card in hand, and
// a card stamped onto the painted layer by the victory cascade all look the
// same. Every card is drawn as its `CARD_W x CARD_H` footprint at its top-left,
// which is the position specs/table.md gives it.

import { CARD_H, CARD_W } from "./constants";
import { colorOf, rankLabel, suitGlyph } from "./deck";
import { COLOR, SANS } from "./theme";
import type { CardState, Suit } from "./game";

/** The destination every drawing helper writes to. */
export type Ctx = CanvasRenderingContext2D;

/** Set the font once, in this build's stack. */
export function setFont(ctx: Ctx, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${SANS}`;
}

/** The color a suit's rank and pips are drawn in. */
export function suitColor(suit: Suit): string {
  return colorOf(suit) === "red" ? COLOR.red : COLOR.black;
}

/** The face of a card: its body, its rank in the corners, and its suit. */
export function drawCardFront(
  ctx: Ctx,
  x: number,
  y: number,
  suit: Suit,
  rank: number,
): void {
  ctx.fillStyle = COLOR.face;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.faceEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2);

  const label = rankLabel(rank);
  const glyph = suitGlyph(suit);
  ctx.fillStyle = suitColor(suit);

  // The index in the top-left corner, and its mirror in the bottom-right, so a
  // card fanned under another still reads.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  setFont(ctx, 22, 700);
  ctx.fillText(label, x + 8, y + 7);
  setFont(ctx, 18);
  ctx.fillText(glyph, x + 8, y + 32);

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  setFont(ctx, 22, 700);
  ctx.fillText(label, x + CARD_W - 8, y + CARD_H - 7);
  setFont(ctx, 18);
  ctx.fillText(glyph, x + CARD_W - 8, y + CARD_H - 32);

  // The suit itself, large enough to read at a glance across the table.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, 64);
  ctx.fillText(glyph, x + CARD_W / 2, y + CARD_H / 2);
}

/** The back of a card: one flat color under a lattice. */
export function drawCardBack(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = COLOR.back;
  ctx.fillRect(x, y, CARD_W, CARD_H);

  // The lattice is clipped to an inset panel, so the pattern never reaches the
  // card's edge and the back reads as one color from any distance.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 8, y + 8, CARD_W - 16, CARD_H - 16);
  ctx.clip();
  ctx.strokeStyle = COLOR.backPattern;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -CARD_H; d < CARD_W + CARD_H; d += 14) {
    ctx.moveTo(x + d, y + 8);
    ctx.lineTo(x + d + CARD_H - 16, y + CARD_H - 8);
    ctx.moveTo(x + d, y + CARD_H - 8);
    ctx.lineTo(x + d + CARD_H - 16, y + 8);
  }
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = COLOR.backEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, CARD_W - 3, CARD_H - 3);
}

/** One card, whichever face it shows. */
export function drawCard(
  ctx: Ctx,
  card: Pick<CardState, "suit" | "rank" | "faceUp">,
  x: number,
  y: number,
): void {
  if (card.faceUp) drawCardFront(ctx, x, y, card.suit, card.rank);
  else drawCardBack(ctx, x, y);
}

/** The mark a pile holding no cards draws at its anchor (specs/table.md). */
export function drawEmptySlot(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = COLOR.slot;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.slotEdge;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 2, y + 2, CARD_W - 4, CARD_H - 4);
}
