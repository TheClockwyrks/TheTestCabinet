// Cascade — drawing the game (specs/table.md, specs/screens.md,
// specs/victory.md).
//
// `render` is handed the state `update` returned, read-only, and the runtime's
// context already cleared to the felt and carrying the logical transform, so
// everything here is written in the stage's own 1280x720 units and nothing reads
// the canvas element.

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
} from "./constants";
import { drawCard, drawEmptySlot, setFont, type Ctx } from "./cards";
import { columnCardTops, dropRect } from "./layout";
import { shownWasteCount } from "./piles";
import { COLOR, HOWTO_LINES, TITLE_HINT } from "./theme";
import type { CardState, CascadeState } from "./game";

/** One line of text, drawn centered on a point. */
function centeredText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
): void {
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, size, weight);
  ctx.fillText(text, x, y);
}

/** A control's panel and its label, the label centered in the rectangle. */
function drawControl(
  ctx: Ctx,
  rect: Rect,
  label: string,
  panel: string = COLOR.panel,
): void {
  ctx.fillStyle = panel;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = COLOR.slotEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  centeredText(
    ctx,
    label,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    Math.min(24, rect.h - 14),
    COLOR.text,
    700,
  );
}

// ---- The table -----------------------------------------------------------

/** A squared pile: every card at the pile's anchor, or the empty slot. */
function drawSquaredPile(
  ctx: Ctx,
  cards: readonly CardState[],
  x: number,
  y: number,
): void {
  if (cards.length === 0) {
    drawEmptySlot(ctx, x, y);
    return;
  }
  for (const card of cards) drawCard(ctx, card, x, y);
}

/** The waste: the cards it shows, squared at its anchor (specs/table.md). */
function drawWaste(ctx: Ctx, state: CascadeState): void {
  if (shownWasteCount(state) <= 0) {
    drawEmptySlot(ctx, WASTE_X, TOP_ROW_Y);
    return;
  }
  for (const card of state.waste) drawCard(ctx, card, WASTE_X, TOP_ROW_Y);
}

/** One column, fanned downward at the offsets its length allows. */
function drawColumn(ctx: Ctx, cards: readonly CardState[], x: number): void {
  if (cards.length === 0) {
    drawEmptySlot(ctx, x, TABLEAU_Y);
    return;
  }
  const tops = columnCardTops(cards);
  for (let i = 0; i < cards.length; i++) drawCard(ctx, cards[i], x, tops[i]);
}

/** All thirteen piles, in the order they sit on the table. */
function drawPiles(ctx: Ctx, state: CascadeState): void {
  drawSquaredPile(ctx, state.stock, STOCK_X, TOP_ROW_Y);
  drawWaste(ctx, state);
  for (let i = 0; i < state.foundations.length; i++) {
    drawSquaredPile(ctx, state.foundations[i], FOUNDATION_X[i], TOP_ROW_Y);
  }
  for (let i = 0; i < state.tableau.length; i++) {
    drawColumn(ctx, state.tableau[i], COLUMN_X[i]);
  }
}

/** The legal target under the held run, drawn apart from the same pile bare. */
function drawDropTarget(ctx: Ctx, state: CascadeState): void {
  const target = state.dropTarget;
  if (target === null) return;
  const rect = dropRect(state, target.pile, target.index);
  ctx.fillStyle = COLOR.highlightWash;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 5;
  ctx.strokeRect(rect.x + 2.5, rect.y + 2.5, rect.w - 5, rect.h - 5);
}

/** The run in hand, above every pile it passes over. */
function drawDrag(ctx: Ctx, state: CascadeState): void {
  const drag = state.drag;
  if (drag === null) return;
  ctx.fillStyle = COLOR.lift;
  ctx.fillRect(
    drag.x + 6,
    drag.y + 8,
    CARD_W,
    CARD_H + FACE_UP_OFFSET * (drag.cards.length - 1),
  );
  for (let i = 0; i < drag.cards.length; i++) {
    drawCard(ctx, drag.cards[i], drag.x, drag.y + i * FACE_UP_OFFSET);
  }
}

/** Every card in flight, wherever the cascade has carried it. */
function drawFlyers(ctx: Ctx, state: CascadeState): void {
  for (const flyer of state.flyers) {
    drawCard(ctx, { ...flyer, faceUp: true }, flyer.x, flyer.y);
  }
}

/** The strip along the bottom: three controls and the deal-mode label. */
function drawHud(ctx: Ctx, state: CascadeState): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, HUD_Y, STAGE_W, HUD_H);

  drawControl(ctx, HUD_NEW_GAME, HUD_ITEMS[0]);
  drawControl(ctx, HUD_MENU, HUD_ITEMS[1]);
  drawControl(
    ctx,
    HUD_SOUND,
    HUD_ITEMS[2],
    state.muted ? COLOR.panelMuted : COLOR.panel,
  );

  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  setFont(ctx, 20, 700);
  ctx.fillText(DEAL_MODE_LABEL, 720, HUD_Y + HUD_H / 2);
}

// ---- The screens ---------------------------------------------------------

/** The title screen: the name, the tagline, the deal mode, and both items. */
function drawTitle(ctx: Ctx): void {
  centeredText(ctx, TITLE_TEXT, STAGE_W / 2, 190, 108, COLOR.text, 700);
  centeredText(ctx, TAGLINE_TEXT, STAGE_W / 2, 280, 34, COLOR.text);
  centeredText(ctx, DEAL_MODE_LABEL, STAGE_W / 2, 340, 26, COLOR.textDim, 700);
  centeredText(ctx, TITLE_HINT, STAGE_W / 2, 390, 20, COLOR.textDim);
  drawControl(ctx, TITLE_NEW_GAME, TITLE_ITEMS[0]);
  drawControl(ctx, TITLE_HOW_TO, TITLE_ITEMS[1]);
}

/** The how-to screen: the prose, and the way back. */
function drawHowTo(ctx: Ctx): void {
  centeredText(ctx, "HOW TO PLAY", STAGE_W / 2, 110, 56, COLOR.text, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.text;
  setFont(ctx, 22);
  for (let i = 0; i < HOWTO_LINES.length; i++) {
    if (HOWTO_LINES[i] === "") continue;
    ctx.fillText(HOWTO_LINES[i], STAGE_W / 2, 200 + i * 30);
  }
  drawControl(ctx, HOWTO_BACK, HOWTO_BACK_LABEL);
}

/** The message the finished cascade leaves over the painted table. */
function drawWinMessage(ctx: Ctx): void {
  const w = 520;
  const h = 140;
  const x = (STAGE_W - w) / 2;
  const y = (STAGE_H - h) / 2;
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  centeredText(ctx, WIN_TEXT, STAGE_W / 2, STAGE_H / 2, 76, COLOR.text, 700);
}

/**
 * One frame of the game.
 *
 * The painted layer goes down first, beneath the cards still on the foundations,
 * the cards in flight, and the win message, exactly as specs/victory.md orders
 * them.
 */
export function renderGame(state: CascadeState, ctx: Ctx): void {
  if (state.screen === "playing" || state.screen === "won") {
    state.trail?.blit(ctx);
    drawPiles(ctx, state);
    drawDropTarget(ctx, state);
    drawDrag(ctx, state);
    drawFlyers(ctx, state);
    if (state.screen === "playing") drawHud(ctx, state);
    if (state.screen === "won" && state.cascadeDone) drawWinMessage(ctx);
    return;
  }

  if (state.screen === "title") drawTitle(ctx);
  else drawHowTo(ctx);
}
