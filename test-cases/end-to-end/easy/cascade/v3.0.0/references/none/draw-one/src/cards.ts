// Cascade — drawing one card, one empty slot, one highlight.
//
// Everything is drawn in code: the build ships no art (`specs/overview.md`).
// Three rules the rest of the drawing leans on:
//
//   * A CARD FILLS ITS WHOLE FOOTPRINT. `CARD_W x CARD_H` at the position given
//     is covered edge to edge, so a card really does occupy the footprint
//     `specs/table.md` fixes wherever it sits.
//   * A RANK AND A PIP ARE EACH DRAWN AS ONE RUN OF TEXT, not glyph by glyph,
//     so what a reader sees on the card and what a reader of the drawing sees
//     are the same string.
//   * Nothing here reads the game. A card is a value, so the same function
//     paints the table, the run in hand, and the cascade's trail.

import { CARD_H, CARD_W } from "./constants";
import { COLOR, RANK_LABEL, SUIT_GLYPH, UI_FONT } from "./theme";
import type { Card } from "./types";
import { suitColor } from "./types";

/** How much of the card's edge the inner panel leaves showing. */
const INSET = 4;

/** A rounded-rectangle path on the current context. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draw a card, face-up or face-down, with its top-left at `(x, y)`. */
export function drawCardOn(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
): void {
  if (card.faceUp) drawFace(ctx, card, x, y);
  else drawBack(ctx, x, y);
}

/** A held card, drawn with a shadow so the run reads as lifted off the table. */
export function drawLiftedCard(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = COLOR.cardEdge;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.restore();
  drawCardOn(ctx, card, x, y);
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
): void {
  ctx.save();
  // The full footprint first, so no pixel of the card's rectangle is table.
  ctx.fillStyle = COLOR.cardEdge;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.fillStyle = COLOR.cardFace;
  roundRectPath(
    ctx,
    x + INSET / 2,
    y + INSET / 2,
    CARD_W - INSET,
    CARD_H - INSET,
    6,
  );
  ctx.fill();

  const ink = suitColor(card.suit) === "red" ? COLOR.red : COLOR.black;
  const rank = RANK_LABEL[card.rank] ?? String(card.rank);
  const pip = SUIT_GLYPH[card.suit] ?? "?";
  ctx.fillStyle = ink;

  // The corner index: the rank over a small pip, each one run of text.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 24px ${UI_FONT}`;
  ctx.fillText(rank, x + 9, y + 8);
  ctx.font = `700 20px ${UI_FONT}`;
  ctx.fillText(pip, x + 9, y + 33);

  // One large pip in the middle, which is what a reader picks the suit out by
  // at the logical stage size.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `62px ${UI_FONT}`;
  ctx.fillText(pip, x + CARD_W / 2, y + CARD_H / 2 + 4);

  // The same index again in the opposite corner, the way a real card reads
  // either way up.
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = `700 24px ${UI_FONT}`;
  ctx.fillText(rank, x + CARD_W - 9, y + CARD_H - 33);
  ctx.font = `700 20px ${UI_FONT}`;
  ctx.fillText(pip, x + CARD_W - 9, y + CARD_H - 8);
  ctx.restore();
}

function drawBack(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = COLOR.backEdge;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.fillStyle = COLOR.backField;
  roundRectPath(
    ctx,
    x + INSET / 2,
    y + INSET / 2,
    CARD_W - INSET,
    CARD_H - INSET,
    6,
  );
  ctx.fill();

  // A lattice motif of this build's own, clipped to the inner panel.
  ctx.save();
  roundRectPath(
    ctx,
    x + INSET,
    y + INSET,
    CARD_W - INSET * 2,
    CARD_H - INSET * 2,
    5,
  );
  ctx.clip();
  ctx.strokeStyle = COLOR.backMotif;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -CARD_H; d < CARD_W + CARD_H; d += 14) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + CARD_H, y + CARD_H);
    ctx.moveTo(x + d, y + CARD_H);
    ctx.lineTo(x + d + CARD_H, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * An empty pile's mark: a card-sized shape at the anchor, dark enough against
 * the felt that a slot reads apart from the bare table.
 */
export function drawSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hint?: string,
): void {
  ctx.save();
  ctx.fillStyle = COLOR.slot;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.slotEdge;
  roundRectPath(ctx, x + 3, y + 3, CARD_W - 6, CARD_H - 6, 6);
  ctx.stroke();
  if (hint !== undefined) {
    ctx.fillStyle = "rgba(246, 251, 247, 0.28)";
    ctx.font = `56px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hint, x + CARD_W / 2, y + CARD_H / 2 + 2);
  }
  ctx.restore();
}

/**
 * The mark a legal drop target under a held run carries: a wash and a thick
 * inset border, both inside the pile's own rectangle so the difference is
 * visible where the pile is.
 */
export function drawHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = COLOR.highlightWash;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLOR.highlight;
  roundRectPath(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 6);
  ctx.stroke();
  ctx.restore();
}
