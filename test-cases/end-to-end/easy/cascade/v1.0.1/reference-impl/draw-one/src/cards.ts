// Cascade — card and slot drawing. Every card and the table are drawn in code
// (no image assets), guided by the palette and measurements in the specs.

import {
  CARD_H,
  CARD_RADIUS,
  CARD_W,
  COLOR,
  UI_FONT,
} from "./constants";
import type { Card } from "./types";
import { cardColor, RANK_LABEL, SUIT_GLYPH } from "./types";

// A rounded-rectangle path on the current context.
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

type ShadowKind = "none" | "normal" | "lifted" | "trail";

function applyShadow(ctx: CanvasRenderingContext2D, kind: ShadowKind): void {
  switch (kind) {
    case "normal":
      ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;
      break;
    case "lifted":
      ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 12;
      break;
    case "trail":
      ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      break;
    default:
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
  }
}

function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export interface DrawOpts {
  shadow?: ShadowKind;
}

// Draw a single card (face-up or face-down) at logical (x, y).
export function drawCard(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  opts: DrawOpts = {},
): void {
  if (card.faceUp) drawFace(ctx, card, x, y, opts.shadow ?? "normal");
  else drawBack(ctx, x, y, opts.shadow ?? "normal");
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
  shadow: ShadowKind,
): void {
  ctx.save();
  applyShadow(ctx, shadow);
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.cardFace;
  ctx.fill();
  clearShadow(ctx);
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.cardBorder;
  ctx.stroke();

  const color = cardColor(card) === "red" ? COLOR.red : COLOR.black;
  ctx.fillStyle = color;
  const rank = RANK_LABEL[card.rank];
  const glyph = SUIT_GLYPH[card.suit];

  // Top-left corner: rank over a small suit pip.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 24px ${UI_FONT}`;
  ctx.fillText(rank, x + 8, y + 7);
  ctx.font = `700 20px ${UI_FONT}`;
  ctx.fillText(glyph, x + 8, y + 31);

  // Bottom-right corner: the same, rotated 180°.
  ctx.save();
  ctx.translate(x + CARD_W, y + CARD_H);
  ctx.rotate(Math.PI);
  ctx.font = `700 24px ${UI_FONT}`;
  ctx.fillText(rank, 8, 7);
  ctx.font = `700 20px ${UI_FONT}`;
  ctx.fillText(glyph, 8, 31);
  ctx.restore();

  // One large central suit pip.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `60px ${UI_FONT}`;
  ctx.fillText(glyph, x + CARD_W / 2, y + CARD_H / 2 + 4);

  ctx.restore();
}

function drawBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shadow: ShadowKind,
): void {
  ctx.save();
  applyShadow(ctx, shadow);
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.backField;
  ctx.fill();
  clearShadow(ctx);

  // Original repeating diamond-lattice motif, clipped to the rounded card.
  ctx.save();
  roundRectPath(ctx, x + 2, y + 2, CARD_W - 4, CARD_H - 4, CARD_RADIUS - 2);
  ctx.clip();
  ctx.strokeStyle = COLOR.backMotif;
  ctx.lineWidth = 2;
  const step = 13;
  ctx.beginPath();
  for (let d = -CARD_H; d < CARD_W + CARD_H; d += step) {
    // Down-right diagonals.
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + CARD_H, y + CARD_H);
    // Down-left diagonals.
    ctx.moveTo(x + d, y + CARD_H);
    ctx.lineTo(x + d + CARD_H, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.backBorder;
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.stroke();
  ctx.restore();
}

// An empty pile slot: a rounded outline with a faint dark fill. `hint` draws a
// large dim glyph centered inside (a foundation suit pip, or the stock's recycle
// glyph).
export function drawSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hint?: string,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.slot;
  ctx.stroke();
  if (hint) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.font = `56px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(hint, x + CARD_W / 2, y + CARD_H / 2 + 2);
  }
  ctx.restore();
}

// A drop-target highlight: a bright rounded outline around a pile slot / card.
export function drawHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.highlight;
  roundRectPath(ctx, x - 1.5, y - 1.5, CARD_W + 3, CARD_H + 3, CARD_RADIUS + 1);
  ctx.stroke();
  ctx.restore();
}
