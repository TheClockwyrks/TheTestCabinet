// Cascade — the table, drawn (specs/table.md, specs/overview.md).
//
// Everything here is a pure read of the state it is handed: nothing advances
// and nothing stores. The functions run inside the draw components in
// `src/table.ts`, whose context arrives cleared and already carrying the
// world-to-device transform — and the game leaves the camera at rest, so world
// units and the stage's logical units coincide and no code below reads the
// canvas element's size.
//
// The look is this build's own (src/theme.ts). What it must deliver is the
// legibility table in `specs/overview.md`: a rank and a suit on every face-up
// card, the two suit colors told apart at a glance, a back that reads apart
// from a face and from the felt, an empty pile that reads as a slot, a run in
// hand that reads as lifted, and a highlighted drop target that reads apart
// from the same pile unhighlighted. A card is drawn as a plain
// `CARD_W x CARD_H` rectangle at its top-left, because that footprint is a
// figure the specification fixes and rounding it off is styling the
// specification leaves alone.

import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  FACE_UP_OFFSET,
  FOUNDATION_X,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  TOP_ROW_Y,
} from "./constants";
import { isRed, rankLabel, suitGlyph } from "./deck";
import type { CascadeState, Suit } from "./game";
import {
  columnCardY,
  dropRect,
  pileAnchor,
  wasteCardTopLeft,
  wasteShownCards,
} from "./layout";
import { COLOR, font, withAlpha } from "./theme";

type Ctx = CanvasRenderingContext2D;

/** The color a suit is drawn in: one for the two red suits, one for the two black. */
export function suitColor(suit: Suit): string {
  return isRed(suit) ? COLOR.suitRed : COLOR.suitBlack;
}

// ---- One card ------------------------------------------------------------

/**
 * The suit's own shape, filled solid and centered on `(cx, cy)`.
 *
 * Every one of the four covers its own center, so the middle of a face-up card
 * always carries that card's suit color and the two colors are told apart
 * wherever a reader looks at the middle of a card.
 */
function drawPip(ctx: Ctx, cx: number, cy: number, size: number, suit: Suit) {
  ctx.beginPath();
  switch (suit) {
    case "diamonds":
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size * 0.72, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size * 0.72, cy);
      ctx.closePath();
      break;
    case "hearts":
      ctx.moveTo(cx, cy + size * 0.92);
      ctx.bezierCurveTo(
        cx - size * 1.35, cy - size * 0.2,
        cx - size * 0.5, cy - size * 1.15,
        cx, cy - size * 0.32,
      );
      ctx.bezierCurveTo(
        cx + size * 0.5, cy - size * 1.15,
        cx + size * 1.35, cy - size * 0.2,
        cx, cy + size * 0.92,
      );
      ctx.closePath();
      break;
    case "spades":
      ctx.moveTo(cx, cy - size * 0.95);
      ctx.bezierCurveTo(
        cx + size * 1.35, cy + size * 0.15,
        cx + size * 0.5, cy + size * 1.05,
        cx, cy + size * 0.28,
      );
      ctx.bezierCurveTo(
        cx - size * 0.5, cy + size * 1.05,
        cx - size * 1.35, cy + size * 0.15,
        cx, cy - size * 0.95,
      );
      ctx.closePath();
      ctx.moveTo(cx - size * 0.28, cy + size);
      ctx.lineTo(cx + size * 0.28, cy + size);
      ctx.lineTo(cx + size * 0.1, cy + size * 0.2);
      ctx.lineTo(cx - size * 0.1, cy + size * 0.2);
      ctx.closePath();
      break;
    case "clubs": {
      const r = size * 0.52;
      ctx.moveTo(cx - size * 0.26, cy + size);
      ctx.lineTo(cx + size * 0.26, cy + size);
      ctx.lineTo(cx + size * 0.1, cy + size * 0.1);
      ctx.lineTo(cx - size * 0.1, cy + size * 0.1);
      ctx.closePath();
      ctx.moveTo(cx + r, cy - size * 0.42);
      ctx.arc(cx, cy - size * 0.42, r, 0, Math.PI * 2);
      ctx.moveTo(cx - size * 0.5 + r, cy + size * 0.28);
      ctx.arc(cx - size * 0.5, cy + size * 0.28, r, 0, Math.PI * 2);
      ctx.moveTo(cx + size * 0.5 + r, cy + size * 0.28);
      ctx.arc(cx + size * 0.5, cy + size * 0.28, r, 0, Math.PI * 2);
      break;
    }
  }
  ctx.fill();
}

/** A face-up card: its body, its rank and its suit, at the top-left `(x, y)`. */
function drawFace(ctx: Ctx, x: number, y: number, suit: Suit, rank: number) {
  ctx.fillStyle = COLOR.cardFace;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.cardEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2);

  const ink = suitColor(suit);
  ctx.fillStyle = ink;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = font(26);
  ctx.fillText(rankLabel(rank), x + 9, y + 8);
  ctx.font = font(20);
  ctx.fillText(suitGlyph(suit), x + 10, y + 38);

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = font(22);
  ctx.fillText(`${rankLabel(rank)}${suitGlyph(suit)}`, x + CARD_W - 9, y + CARD_H - 8);

  drawPip(ctx, x + CARD_W / 2, y + CARD_H / 2, 25, suit);
}

/** A face-down card: its body, its lattice and the emblem at its middle. */
function drawBack(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = COLOR.cardBack;
  ctx.fillRect(x, y, CARD_W, CARD_H);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 8, y + 8, CARD_W - 16, CARD_H - 16);
  ctx.clip();
  ctx.strokeStyle = COLOR.cardBackLattice;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let offset = -CARD_H; offset < CARD_W + CARD_H; offset += 16) {
    ctx.moveTo(x + offset, y);
    ctx.lineTo(x + offset + CARD_H, y + CARD_H);
    ctx.moveTo(x + offset + CARD_H, y);
    ctx.lineTo(x + offset, y + CARD_H);
  }
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = COLOR.cardBackEmblem;
  ctx.beginPath();
  ctx.moveTo(x + CARD_W / 2, y + CARD_H / 2 - 20);
  ctx.lineTo(x + CARD_W / 2 + 15, y + CARD_H / 2);
  ctx.lineTo(x + CARD_W / 2, y + CARD_H / 2 + 20);
  ctx.lineTo(x + CARD_W / 2 - 15, y + CARD_H / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = COLOR.cardEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2);
}

/** One card at its top-left, face-up or face-down. */
export function drawCard(
  ctx: Ctx,
  x: number,
  y: number,
  suit: Suit,
  rank: number,
  faceUp: boolean,
): void {
  if (faceUp) drawFace(ctx, x, y, suit, rank);
  else drawBack(ctx, x, y);
}

/** The card-sized mark an empty pile draws at its anchor. */
function drawSlot(ctx: Ctx, x: number, y: number) {
  ctx.fillStyle = COLOR.slot;
  ctx.fillRect(x, y, CARD_W, CARD_H);
  ctx.strokeStyle = COLOR.slotEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2);
}

// ---- The table -----------------------------------------------------------

/** The felt, which the letterbox bars around the stage also carry. */
export function renderFelt(ctx: Ctx): void {
  ctx.fillStyle = COLOR.felt;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** The painted layer, blitted in one call beneath everything still on the table. */
export function renderTrail(state: CascadeState, ctx: Ctx): void {
  const image = state.trail.image();
  if (image === null) return;
  ctx.drawImage(image, 0, 0);
}

/** The thirteen piles, and the highlight around the pile a held run would land on. */
export function renderPiles(state: CascadeState, ctx: Ctx): void {
  const slots = state.screen === "playing";

  if (state.stock.length > 0) {
    const top = state.stock[state.stock.length - 1];
    drawCard(ctx, STOCK_X, TOP_ROW_Y, top.suit, top.rank, top.faceUp);
  } else if (slots) {
    drawSlot(ctx, STOCK_X, TOP_ROW_Y);
  }

  const shown = wasteShownCards(state);
  if (shown.length > 0) {
    shown.forEach((card, index) => {
      const [x, y] = wasteCardTopLeft(index);
      drawCard(ctx, x, y, card.suit, card.rank, card.faceUp);
    });
  } else if (slots) {
    const [x, y] = pileAnchor("waste", 0);
    drawSlot(ctx, x, y);
  }

  state.foundations.forEach((foundation, index) => {
    const x = FOUNDATION_X[index];
    if (foundation.length === 0) {
      if (slots) drawSlot(ctx, x, TOP_ROW_Y);
      return;
    }
    const top = foundation[foundation.length - 1];
    drawCard(ctx, x, TOP_ROW_Y, top.suit, top.rank, top.faceUp);
  });

  state.tableau.forEach((column, index) => {
    if (column.length === 0) {
      if (slots) drawSlot(ctx, COLUMN_X[index], columnCardY(column, 0));
      return;
    }
    column.forEach((card, row) => {
      drawCard(
        ctx,
        COLUMN_X[index],
        columnCardY(column, row),
        card.suit,
        card.rank,
        card.faceUp,
      );
    });
  });

  const target = state.dropTarget;
  if (target === null) return;
  const rect = dropRect(state, target.pile, target.index);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 6;
  ctx.strokeRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6);
}

/** The run in hand, drawn above every pile it passes over. */
export function renderDrag(state: CascadeState, ctx: Ctx): void {
  const drag = state.drag;
  if (drag === null) return;

  const height = CARD_H + FACE_UP_OFFSET * (drag.cards.length - 1);
  ctx.fillStyle = withAlpha("#000000", 0.28);
  ctx.fillRect(drag.x + 6, drag.y + 8, CARD_W, height);

  drag.cards.forEach((card, index) => {
    drawCard(
      ctx,
      drag.x,
      drag.y + index * FACE_UP_OFFSET,
      card.suit,
      card.rank,
      card.faceUp,
    );
  });
}

/** Every card in flight, at the position the cascade's integration left it. */
export function renderFlyers(state: CascadeState, ctx: Ctx): void {
  for (const flyer of state.flyers) {
    drawCard(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank, true);
  }
}
