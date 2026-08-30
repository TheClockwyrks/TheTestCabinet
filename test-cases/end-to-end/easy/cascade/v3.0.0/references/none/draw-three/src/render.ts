// Cascade — every mark the game makes on the canvas.
//
// Rendering is a pure function of the state: nothing here writes to the state, so
// the simulation and the picture cannot disagree and a frame can be advanced with
// no drawing taking part in the result (specs/instrumentation.md). It draws in the
// stage's logical units alone; the map onto device pixels is the runtime's
// (`src/viewport.ts`).
//
// Every card is drawn as shapes and text. The build ships no art and fetches
// nothing (specs/overview.md), so the four suit pips are vector paths rather than
// font glyphs — which also means a card face reads the same on a host with no
// symbol font installed.
//
// The geometry is `src/layout.ts`'s and the look is `src/theme.ts`'s; what is here
// is the arrangement of the two.

import { cardColor, RANK_LABEL, type Card } from "./cards";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DEAL_MODE_LABEL,
  FACE_UP_OFFSET,
  FOUNDATION_X,
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
  STOCK_X,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_HOW_TO,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  TOP_ROW_Y,
  WASTE_X,
  WIN_TEXT,
  type Rect,
  type Suit,
} from "./constants";
import { columnCardTops, dropRect, wasteFanX } from "./layout";
import type { CascadeState } from "./state";
import { CARD_RADIUS, COLOR, FONT } from "./theme";
import { wasteShownCount } from "./waste";

/** How to play, in a player's words. */
const HOWTO_LINES: readonly string[] = [
  "Build all four foundations up from ACE to KING, one suit each.",
  "That is the whole game: get every card home.",
  "",
  "A column builds down in rank and alternates in color, so a red six",
  "goes on a black seven. Only a KING, or a run led by one, fills an",
  "empty column. Uncover a face-down card and it turns itself over.",
  "",
  "Click the STOCK to turn three cards onto the waste, and the front",
  "one is yours to play. Run the stock out and it recycles, as often",
  "as you like.",
  "",
  "Drag a card or a run to move it. DOUBLE-CLICK a card to send it",
  "straight home. Fill all four foundations and the table gives way.",
] as const;

/** Trace a rounded rectangle. Written out, so no host needs `roundRect`. */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
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

/** Draw one line of text centered on a point. */
function centeredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color: string,
  weight = "600",
): void {
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ---- The suit pips, as vector paths --------------------------------------

/** A diamond, drawn in a `size` box with its top-left at `(x, y)`. */
function diamondPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + size / 2, y);
  ctx.lineTo(x + size, y + size / 2);
  ctx.lineTo(x + size / 2, y + size);
  ctx.lineTo(x, y + size / 2);
  ctx.closePath();
}

/** A heart, in the same box. */
function heartPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size / 2;
  const lobe = size * 0.26;
  ctx.beginPath();
  ctx.moveTo(cx, y + size);
  ctx.bezierCurveTo(
    x - size * 0.1,
    y + size * 0.55,
    x + size * 0.06,
    y,
    cx,
    y + lobe,
  );
  ctx.bezierCurveTo(
    x + size * 0.94,
    y,
    x + size * 1.1,
    y + size * 0.55,
    cx,
    y + size,
  );
  ctx.closePath();
}

/** A spade, in the same box. */
function spadePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.bezierCurveTo(
    x + size * 1.16,
    y + size * 0.5,
    x + size * 0.86,
    y + size * 0.92,
    cx + size * 0.08,
    y + size * 0.74,
  );
  ctx.lineTo(cx + size * 0.2, y + size);
  ctx.lineTo(cx - size * 0.2, y + size);
  ctx.lineTo(cx - size * 0.08, y + size * 0.74);
  ctx.bezierCurveTo(
    x + size * 0.14,
    y + size * 0.92,
    x - size * 0.16,
    y + size * 0.5,
    cx,
    y,
  );
  ctx.closePath();
}

/** A club, in the same box. */
function clubPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const cx = x + size / 2;
  const r = size * 0.24;
  ctx.beginPath();
  ctx.arc(cx, y + r * 1.05, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.moveTo(cx - r * 0.9 + r, y + size * 0.58);
  ctx.arc(cx - r * 0.95, y + size * 0.58, r, 0, Math.PI * 2);
  ctx.moveTo(cx + r * 0.95 + r, y + size * 0.58);
  ctx.arc(cx + r * 0.95, y + size * 0.58, r, 0, Math.PI * 2);
  ctx.moveTo(cx - size * 0.2, y + size);
  ctx.lineTo(cx + size * 0.2, y + size);
  ctx.lineTo(cx + size * 0.07, y + size * 0.58);
  ctx.lineTo(cx - size * 0.07, y + size * 0.58);
  ctx.closePath();
}

/** Fill one suit pip in a `size` box with its top-left at `(x, y)`. */
export function drawPip(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = cardColor(suit) === "red" ? COLOR.red : COLOR.black;
  switch (suit) {
    case "diamonds":
      diamondPath(ctx, x, y, size);
      break;
    case "hearts":
      heartPath(ctx, x, y, size);
      break;
    case "spades":
      spadePath(ctx, x, y, size);
      break;
    case "clubs":
      clubPath(ctx, x, y, size);
      break;
  }
  ctx.fill();
}

// ---- Cards ---------------------------------------------------------------

/** The plate every card, face or back, is drawn on. */
function cardPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: string,
  edge: string,
): void {
  roundedPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/**
 * A face-up card: its rank and its suit, drawn on it and legible at the logical
 * stage size, in the color its suit is drawn in.
 */
export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  rank: number,
  x: number,
  y: number,
): void {
  cardPlate(ctx, x, y, COLOR.cardFace, COLOR.cardEdge);
  const ink = cardColor(suit) === "red" ? COLOR.red : COLOR.black;
  const label = RANK_LABEL[rank] ?? String(rank);

  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  ctx.fillText(label, x + 9, y + 7);
  drawPip(ctx, suit, x + 10, y + 38, 18);

  // The big center pip, which is what carries the suit at a glance.
  drawPip(ctx, suit, x + CARD_W / 2 - 21, y + CARD_H / 2 - 26, 42);

  // The corner repeated upside down, the way a real card reads either way up.
  ctx.save();
  ctx.translate(x + CARD_W, y + CARD_H);
  ctx.rotate(Math.PI);
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  ctx.fillText(label, 9, 7);
  drawPip(ctx, suit, 10, 38, 18);
  ctx.restore();
}

/** A face-down card: a cobalt back that reads apart from a face and the felt. */
export function drawCardBack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  cardPlate(ctx, x, y, COLOR.backFill, COLOR.backEdge);
  ctx.save();
  roundedPath(ctx, x + 8, y + 8, CARD_W - 16, CARD_H - 16, CARD_RADIUS - 3);
  ctx.clip();
  ctx.strokeStyle = COLOR.backMotif;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 14) {
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + CARD_H, y + CARD_H);
  }
  ctx.stroke();
  ctx.restore();
  roundedPath(ctx, x + 8, y + 8, CARD_W - 16, CARD_H - 16, CARD_RADIUS - 3);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.backMotif;
  ctx.stroke();
}

/** One card, whichever way up it lies. */
export function drawCard(
  ctx: CanvasRenderingContext2D,
  card: Card,
  x: number,
  y: number,
): void {
  if (card.faceUp) drawCardFace(ctx, card.suit, card.rank, x, y);
  else drawCardBack(ctx, x, y);
}

/** An empty pile: a card-sized mark that reads apart from the bare table. */
export function drawSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  roundedPath(ctx, x, y, CARD_W, CARD_H, CARD_RADIUS);
  ctx.fillStyle = COLOR.slotFill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.slotLine;
  ctx.stroke();
}

// ---- The table -----------------------------------------------------------

/** The felt, with a vignette so the stage's edges read. */
function drawTable(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.table;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.strokeStyle = COLOR.tableEdge;
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, STAGE_W - 16, STAGE_H - 16);
}

/** The stock: its top card's back, or its slot. */
function drawStock(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  if (state.stock.length === 0) {
    drawSlot(ctx, STOCK_X, TOP_ROW_Y);
    return;
  }
  drawCardBack(ctx, STOCK_X, TOP_ROW_Y);
}

/** The waste: the shown set fanned, over whatever is squared away beneath. */
function drawWaste(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  if (state.wasteSets.length === 0) {
    drawSlot(ctx, WASTE_X, TOP_ROW_Y);
    return;
  }
  const shown = wasteShownCount(state);
  const buried = state.waste.length - shown;
  if (buried <= 0 && shown === 0) {
    drawSlot(ctx, WASTE_X, TOP_ROW_Y);
    return;
  }
  if (buried > 0) drawCard(ctx, state.waste[buried - 1], WASTE_X, TOP_ROW_Y);
  for (let k = 0; k < shown; k += 1) {
    drawCard(ctx, state.waste[buried + k], wasteFanX(k), TOP_ROW_Y);
  }
}

/** The four foundations: each one's top card, or its slot. */
function drawFoundations(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  for (let i = 0; i < state.foundations.length; i += 1) {
    const pile = state.foundations[i];
    if (pile.length === 0) {
      drawSlot(ctx, FOUNDATION_X[i], TOP_ROW_Y);
      continue;
    }
    drawCard(ctx, pile[pile.length - 1], FOUNDATION_X[i], TOP_ROW_Y);
  }
}

/** The seven columns, fanned downward at the offsets the layout works out. */
function drawColumns(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  for (let col = 0; col < state.tableau.length; col += 1) {
    const column = state.tableau[col];
    if (column.length === 0) {
      drawSlot(ctx, COLUMN_X[col], TABLEAU_Y);
      continue;
    }
    const tops = columnCardTops(column);
    for (let row = 0; row < column.length; row += 1) {
      drawCard(ctx, column[row], COLUMN_X[col], tops[row]);
    }
  }
}

/** The highlight around the pile a release would land the held run on. */
function drawDropTarget(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  const target = state.dropTarget;
  if (target === null) return;
  const rect = dropRect(state, target.pile, target.index);
  roundedPath(
    ctx,
    rect.x - 4,
    rect.y - 4,
    rect.w + 8,
    rect.h + 8,
    CARD_RADIUS + 4,
  );
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLOR.highlight;
  ctx.stroke();
}

/** The run in hand, drawn above the piles it passes over. */
function drawDrag(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  const drag = state.drag;
  if (drag === null) return;
  ctx.shadowColor = COLOR.shadow;
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 10;
  for (let i = 0; i < drag.cards.length; i += 1) {
    drawCard(ctx, drag.cards[i], drag.x, drag.y + i * FACE_UP_OFFSET);
  }
  // Cleared by hand rather than by a restore: a 2D context is not obliged to
  // carry every property through save and restore, and a leaked shadow would
  // smear the next thing drawn.
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** Every card in flight, at its position. */
function drawFlyers(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  for (const flyer of state.flyers) {
    drawCardFace(ctx, flyer.suit, flyer.rank, flyer.x, flyer.y);
  }
}

/** A control's plate and its label, drawn inside its own rectangle. */
function drawControl(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  px: number,
): void {
  roundedPath(ctx, rect.x, rect.y, rect.w, rect.h, 8);
  ctx.fillStyle = COLOR.plateFill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.plateEdge;
  ctx.stroke();
  centeredText(
    ctx,
    label,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    px,
    COLOR.text,
  );
}

/** The HUD strip: three controls and the deal-mode label. */
function drawHud(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.hudFill;
  ctx.fillRect(0, HUD_Y, STAGE_W, HUD_H);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_Y, STAGE_W, 2);

  drawControl(ctx, HUD_NEW_GAME, HUD_ITEMS[0], 17);
  drawControl(ctx, HUD_MENU, HUD_ITEMS[1], 17);
  drawControl(ctx, HUD_SOUND, HUD_ITEMS[2], 17);

  ctx.font = `600 16px ${FONT}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(
    `${DEAL_MODE_LABEL}${state.muted ? "   MUTED" : ""}`,
    STAGE_W - 24,
    HUD_Y + HUD_H / 2,
  );
}

/** The message the finished cascade leaves over the painted table. */
function drawWinMessage(ctx: CanvasRenderingContext2D): void {
  const w = 520;
  const h = 150;
  const x = (STAGE_W - w) / 2;
  const y = 250;
  roundedPath(ctx, x, y, w, h, 16);
  ctx.fillStyle = COLOR.panel;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.highlight;
  ctx.stroke();
  centeredText(ctx, WIN_TEXT, STAGE_W / 2, y + 62, 62, COLOR.highlight, "800");
  centeredText(
    ctx,
    "CLICK TO DEAL AGAIN",
    STAGE_W / 2,
    y + 114,
    18,
    COLOR.textDim,
  );
}

/** The title screen. */
function drawTitle(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  centeredText(ctx, TITLE_TEXT, STAGE_W / 2, 210, 108, COLOR.text, "800");
  centeredText(ctx, TAGLINE_TEXT, STAGE_W / 2, 296, 30, COLOR.textDim, "600");
  centeredText(ctx, DEAL_MODE_LABEL, STAGE_W / 2, 366, 22, COLOR.highlight);
  drawControl(ctx, TITLE_NEW_GAME, TITLE_ITEMS[0], 24);
  drawControl(ctx, TITLE_HOW_TO, TITLE_ITEMS[1], 24);
  centeredText(
    ctx,
    state.muted ? "SOUND OFF" : "",
    STAGE_W / 2,
    620,
    16,
    COLOR.textDim,
  );
}

/** The how-to screen. */
function drawHowTo(ctx: CanvasRenderingContext2D): void {
  centeredText(ctx, "HOW TO PLAY", STAGE_W / 2, 92, 44, COLOR.text, "800");
  ctx.font = `500 21px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.textDim;
  HOWTO_LINES.forEach((line, index) => {
    if (line !== "") ctx.fillText(line, STAGE_W / 2, 168 + index * 30);
  });
  drawControl(ctx, HOWTO_BACK, HOWTO_BACK_LABEL, 24);
}

/** The live table, which the `playing` and `won` screens both draw. */
function drawPlayfield(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  // Beneath the piles, the cards in flight and the win message, as
  // specs/victory.md requires.
  state.trail.blit(ctx);
  drawStock(state, ctx);
  drawWaste(state, ctx);
  drawFoundations(state, ctx);
  drawColumns(state, ctx);
  drawDropTarget(state, ctx);
  drawFlyers(state, ctx);
  drawDrag(state, ctx);
}

/** Draw the state the update left behind. */
export function render(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  drawTable(ctx);
  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      return;
    case "howto":
      drawHowTo(ctx);
      return;
    case "playing":
      drawPlayfield(state, ctx);
      drawHud(state, ctx);
      return;
    case "won":
      drawPlayfield(state, ctx);
      if (state.cascadeDone) drawWinMessage(ctx);
      return;
  }
}
