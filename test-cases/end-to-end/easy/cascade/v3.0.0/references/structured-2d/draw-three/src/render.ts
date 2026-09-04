// Cascade — every mark the game makes, in the stage's logical units.
//
// The engine owns the pipeline; `src/table.ts` attaches one draw component per
// layer of the picture and each of them calls into this module. Everything here
// is a PURE READ of the state it is handed: nothing in this file writes a field,
// so the picture is the frame the ticks produced and watching it changes nothing
// (`specs/state.md`, The contract).
//
// The camera is left at rest, so world units and the stage's logical units
// coincide and every coordinate below is a stage coordinate. A card is placed by
// its TOP-LEFT corner, which is the convention `specs/overview.md` fixes.
//
// What a player must read at a glance is `specs/overview.md`'s legibility table;
// which colour and which type it is read in is this build's, and lives in
// `src/theme.ts`.

import {
  CARD_H,
  CARD_W,
  DEAL_MODE_LABEL,
  FACE_UP_OFFSET,
  HOWTO_BACK,
  HOWTO_BACK_LABEL,
  HUD_H,
  HUD_ITEMS,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HUD_Y,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_HOW_TO,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  WIN_TEXT,
  type Rect,
} from "./constants";
import { colorOf, rankLabel } from "./deck";
import type { CardState, CascadeState, Suit } from "./game";
import { columnBottom, drawnCards, pileAnchor } from "./layout";
import { wasteVisibleCount } from "./piles";
import { CARD_RADIUS, COLOR, LAYER, font } from "./theme";

/** The four lines the how-to screen is written in, in a player's own words. */
export const HOWTO_LINES: readonly string[] = [
  "Build all four foundations from ACE up to KING, one suit each.",
  "Stack the columns down in rank, red and black in turn.",
  "Only a KING fills a column you have emptied.",
  "Click the STOCK to turn cards onto the waste; it recycles when it runs dry.",
  "Drag a card to move it, or DOUBLE-CLICK it to send it straight home.",
];

export { LAYER };

// ---- Small drawing helpers ------------------------------------------------

/** A rounded rectangle as a path, drawn without relying on `ctx.roundRect`. */
function roundRectPath(
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
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** One line of text, centred on a point. */
function centredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spec: string,
  fill: string,
): void {
  ctx.font = spec;
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/**
 * The suit's pip, as a filled path rather than a glyph, so the shape and its
 * colour are drawn by the game itself rather than by whatever font the host
 * happens to carry.
 */
function pip(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  cx: number,
  cy: number,
  s: number,
): void {
  ctx.fillStyle = colorOf(suit) === "red" ? COLOR.red : COLOR.black;
  ctx.beginPath();
  switch (suit) {
    case "diamonds":
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + 0.72 * s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - 0.72 * s, cy);
      ctx.closePath();
      break;
    case "hearts":
      ctx.moveTo(cx, cy + s);
      ctx.bezierCurveTo(
        cx - 1.35 * s,
        cy - 0.2 * s,
        cx - 0.8 * s,
        cy - 1.25 * s,
        cx,
        cy - 0.5 * s,
      );
      ctx.bezierCurveTo(
        cx + 0.8 * s,
        cy - 1.25 * s,
        cx + 1.35 * s,
        cy - 0.2 * s,
        cx,
        cy + s,
      );
      ctx.closePath();
      break;
    case "spades":
      ctx.moveTo(cx, cy - s);
      ctx.bezierCurveTo(
        cx - 1.35 * s,
        cy + 0.2 * s,
        cx - 0.8 * s,
        cy + 1.05 * s,
        cx - 0.18 * s,
        cy + 0.5 * s,
      );
      ctx.lineTo(cx - 0.38 * s, cy + s);
      ctx.lineTo(cx + 0.38 * s, cy + s);
      ctx.lineTo(cx + 0.18 * s, cy + 0.5 * s);
      ctx.bezierCurveTo(
        cx + 0.8 * s,
        cy + 1.05 * s,
        cx + 1.35 * s,
        cy + 0.2 * s,
        cx,
        cy - s,
      );
      ctx.closePath();
      break;
    case "clubs": {
      const r = 0.46 * s;
      ctx.moveTo(cx + r, cy - 0.34 * s);
      ctx.arc(cx, cy - 0.34 * s, r, 0, Math.PI * 2);
      ctx.moveTo(cx - 0.5 * s + r, cy + 0.3 * s);
      ctx.arc(cx - 0.5 * s, cy + 0.3 * s, r, 0, Math.PI * 2);
      ctx.moveTo(cx + 0.5 * s + r, cy + 0.3 * s);
      ctx.arc(cx + 0.5 * s, cy + 0.3 * s, r, 0, Math.PI * 2);
      ctx.moveTo(cx - 0.26 * s, cy + s);
      ctx.lineTo(cx + 0.26 * s, cy + s);
      ctx.lineTo(cx + 0.13 * s, cy + 0.1 * s);
      ctx.lineTo(cx - 0.13 * s, cy + 0.1 * s);
      ctx.closePath();
      break;
    }
  }
  ctx.fill();
}

// ---- A card ---------------------------------------------------------------

/**
 * A face-up card: its body, its rank and its suit, drawn so both read at the
 * logical stage size. The rank and the suit are drawn twice over — as the index
 * in the corners and as the pip across the middle — and both carry the suit's
 * colour, so red and black are told apart wherever a reader looks.
 */
export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  suit: Suit,
  rank: number,
): void {
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.cardFace;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.cardEdge;
  ctx.stroke();

  // The index in two corners and the pip across the middle, all three in the
  // suit's own colour, so the rank and the suit both read at the logical stage
  // size and red and black are told apart wherever a reader looks.
  const ink = colorOf(suit) === "red" ? COLOR.red : COLOR.black;
  const label = rankLabel(rank);

  ctx.fillStyle = ink;
  ctx.font = font(28);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 10, y + 8);

  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x + CARD_W - 10, y + CARD_H - 8);

  pip(ctx, suit, x + CARD_W / 2, y + CARD_H / 2, 26);
}

/** A face-down card: its back, which reads apart from a face and from the felt. */
export function drawCardBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.cardBack;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.cardEdge;
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x + 9, y + 9, CARD_W - 18, CARD_H - 18, CARD_RADIUS - 3);
  ctx.clip();
  ctx.strokeStyle = COLOR.cardBackInk;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let d = -CARD_H; d < CARD_W + CARD_H; d += 14) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + CARD_H, y + CARD_H);
  }
  ctx.stroke();
  ctx.restore();

  roundRectPath(ctx, x + 9, y + 9, CARD_W - 18, CARD_H - 18, CARD_RADIUS - 3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.cardBackInk;
  ctx.stroke();
}

/** Either face of a card, at its top-left. */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  card: CardState,
): void {
  if (card.faceUp) drawCardFace(ctx, x, y, card.suit, card.rank);
  else drawCardBack(ctx, x, y);
}

/** One stamp of a card in flight onto the painted layer. */
export function paintCardOnTrail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  suit: Suit,
  rank: number,
): void {
  drawCardFace(ctx, x, y, suit, rank);
}

/** The mark a pile holding no cards draws at its anchor. */
function drawSlot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  roundRectPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.slot;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.slotEdge;
  ctx.stroke();
}

/** A control's plate and its label, drawn inside the control's own rectangle. */
function drawControl(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  size: number,
): void {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 8);
  ctx.fillStyle = COLOR.plate;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.plateEdge;
  ctx.stroke();
  centredText(
    ctx,
    label,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    font(size),
    COLOR.ink,
  );
}

// ---- The layers of the picture --------------------------------------------

/** The felt the whole table is played on. */
export function renderFelt(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.felt;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** The painted layer the cascade leaves behind, blitted whole. */
export function renderTrail(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  const layer = state.trail.image();
  if (layer === null) return;
  ctx.drawImage(layer, 0, 0);
}

/** The mark every empty pile draws, so an empty slot reads apart from the felt. */
export function renderSlots(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.stock.length === 0) {
    const at = pileAnchor("stock", 0);
    if (at !== null) drawSlot(ctx, at.x, at.y);
  }
  // A waste whose set memory is empty shows no card, so it draws the slot
  // whatever cards it still holds (`specs/table.md`).
  if (wasteVisibleCount(state) === 0) {
    const at = pileAnchor("waste", 0);
    if (at !== null) drawSlot(ctx, at.x, at.y);
  }
  state.foundations.forEach((cards, index) => {
    if (cards.length > 0) return;
    const at = pileAnchor("foundation", index);
    if (at !== null) drawSlot(ctx, at.x, at.y);
  });
  state.tableau.forEach((cards, index) => {
    if (cards.length > 0) return;
    const at = pileAnchor("tableau", index);
    if (at !== null) drawSlot(ctx, at.x, at.y);
  });
}

/** Every card the thirteen piles draw, at the anchors and fans the table fixes. */
export function renderCards(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  for (const entry of drawnCards(state)) {
    drawCard(ctx, entry.x, entry.y, entry.card);
  }
  renderDropTarget(state, ctx);
}

/** The legal drop target under the held run, drawn as highlighted. */
function renderDropTarget(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  const target = state.dropTarget;
  if (target === null) return;

  const at = pileAnchor(target.pile, target.index);
  if (at === null) return;

  let y = at.y;
  if (target.pile === "tableau") {
    const cards = state.tableau[target.index];
    y = columnBottom(cards) - CARD_H;
  }

  roundRectPath(ctx, at.x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.highlightWash;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLOR.highlight;
  ctx.stroke();
}

/** Every card in flight, at its own position. */
export function renderFlyers(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  for (const flyer of state.flyers) {
    drawCardFace(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank);
  }
}

/** The run in hand, drawn above every pile it passes over. */
export function renderHand(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  const drag = state.drag;
  if (drag === null) return;

  ctx.save();
  ctx.fillStyle = COLOR.shadow;
  const depth = (drag.cards.length - 1) * FACE_UP_OFFSET;
  roundRectPath(
    ctx,
    drag.x + 7,
    drag.y + 9,
    CARD_W,
    CARD_H + depth,
    CARD_RADIUS,
  );
  ctx.fill();
  ctx.restore();

  drag.cards.forEach((card, i) => {
    drawCard(ctx, drag.x, drag.y + i * FACE_UP_OFFSET, card);
  });

  roundRectPath(ctx, drag.x, drag.y, CARD_W, CARD_H + depth, CARD_RADIUS);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.highlight;
  ctx.stroke();
}

/** The HUD strip: its three controls and this build's deal-mode label. */
export function renderHud(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.hudStrip;
  ctx.fillRect(0, HUD_Y, STAGE_W, HUD_H);

  drawControl(ctx, HUD_NEW_GAME, HUD_ITEMS[0], 18);
  drawControl(ctx, HUD_MENU, HUD_ITEMS[1], 18);
  drawControl(ctx, HUD_SOUND, HUD_ITEMS[2], 18);

  ctx.font = font(18);
  ctx.fillStyle = COLOR.inkDim;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(DEAL_MODE_LABEL, STAGE_W - 28, HUD_Y + HUD_H / 2);
}

/** The title screen. */
export function renderTitle(ctx: CanvasRenderingContext2D): void {
  centredText(ctx, TITLE_TEXT, STAGE_W / 2, 190, font(104), COLOR.accent);
  centredText(ctx, TAGLINE_TEXT, STAGE_W / 2, 282, font(34), COLOR.ink);
  centredText(ctx, DEAL_MODE_LABEL, STAGE_W / 2, 344, font(26), COLOR.inkDim);
  drawControl(ctx, TITLE_NEW_GAME, TITLE_ITEMS[0], 26);
  drawControl(ctx, TITLE_HOW_TO, TITLE_ITEMS[1], 26);
}

/** The how-to screen. */
export function renderHowto(ctx: CanvasRenderingContext2D): void {
  centredText(ctx, "HOW TO PLAY", STAGE_W / 2, 150, font(58), COLOR.accent);
  HOWTO_LINES.forEach((line, i) => {
    centredText(
      ctx,
      line,
      STAGE_W / 2,
      260 + i * 54,
      font(24, "normal"),
      COLOR.ink,
    );
  });
  drawControl(ctx, HOWTO_BACK, HOWTO_BACK_LABEL, 26);
}

/** The message the won screen shows over the painted table, once the cascade is done. */
export function renderWon(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!state.cascadeDone) return;
  roundRectPath(ctx, STAGE_W / 2 - 260, 280, 520, 140, 18);
  ctx.fillStyle = "rgba(6, 34, 20, 0.86)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLOR.accent;
  ctx.stroke();
  centredText(ctx, WIN_TEXT, STAGE_W / 2, 350, font(84), COLOR.accent);
}
