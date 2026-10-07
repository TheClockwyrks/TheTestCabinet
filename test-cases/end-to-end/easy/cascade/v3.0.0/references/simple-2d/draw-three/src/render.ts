// Cascade — the drawing.
//
// `render` is handed the state `update` returned, read-only, and a context that
// arrives cleared and already carrying the logical transform, so everything here
// is written in 1280x720 coordinates and nothing reads the canvas element.
//
// Where each card goes is `src/layout.ts`'s answer, and it is the same answer the
// pointer's hit test reads, so what a player presses is what a player sees. What
// a card looks like is `src/card-art.ts`'s. What is left here is the order things
// are drawn in and the four screens.

import {
  CARD_H,
  CARD_W,
  DEAL_MODE_LABEL,
  FACE_UP_OFFSET,
  FOUNDATION_COUNT,
  HOWTO_BACK_LABEL,
  HUD_H,
  HUD_ITEMS,
  HUD_Y,
  STAGE_H,
  STAGE_W,
  TABLEAU_COLUMNS,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  WIN_TEXT,
} from "./constants";
import {
  HOWTO_BACK,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  TITLE_HOW_TO,
  TITLE_NEW_GAME,
} from "./menus";
import type { Rect } from "./layout";
import { drawCard, drawCardFace, drawEmptySlot } from "./card-art";
import { dropRect, drawnCards, pileAnchor, wasteShownCount } from "./layout";
import { COLOR, font } from "./theme";
import type { CascadeState } from "./game";
import type { Ctx2D } from "./trail";
import type { DeepReadonly } from "ts-essentials";

/** The lines the how-to screen carries (`specs/screens.md`). */
export const HOWTO_LINES: readonly string[] = [
  "Build all four foundations up from ACE to KING, one suit on each.",
  "Every one of the fifty-two cards home wins, and the table gives way.",
  "",
  "A column builds down in rank and alternates in color, red on black.",
  "Only a KING, or a run led by one, may fill an empty column.",
  "",
  "Click the STOCK to turn cards onto the waste, and play the front one.",
  "When the STOCK runs out, click it again to pass through the waste anew.",
  "",
  "Drag a card, or a run of cards, onto the pile you want it on.",
  "DOUBLE-CLICK a card to send it straight to its foundation.",
];

/** Draw one string. */
function text(
  ctx: Ctx2D,
  value: string,
  x: number,
  y: number,
  options: {
    size: number;
    color?: string;
    weight?: "normal" | "bold";
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
  },
): void {
  ctx.font = font(options.size, options.weight ?? "normal");
  ctx.fillStyle = options.color ?? COLOR.text;
  ctx.textAlign = options.align ?? "center";
  ctx.textBaseline = options.baseline ?? "middle";
  ctx.fillText(value, x, y);
}

/** Draw a plate: the block a label sits on. */
function plate(ctx: Ctx2D, rect: Rect, fill: string, line: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
}

/**
 * Draw a label centred in its own rectangle.
 *
 * THE SELECTED ITEM IS DRAWN DISTINCTLY, which specs/controls.md requires of
 * every menu: "the selected item is drawn distinctly from the others".
 * Here that is the label's colour, and {@link plate} carries the same mark on the
 * border; the plate's fill and the rectangle's size are left alone, so a label is
 * read against the same ground whichever item is selected.
 */
function labelled(
  ctx: Ctx2D,
  rect: Rect,
  label: string,
  size: number,
  selected = false,
): void {
  text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
    size,
    weight: "bold",
    ...(selected ? { color: COLOR.highlight } : {}),
  });
}

/** The felt, filled edge to edge. */
function drawFelt(ctx: Ctx2D, width: number, height: number): void {
  ctx.fillStyle = COLOR.felt;
  ctx.fillRect(0, 0, width, height);
}

/** The card-sized mark every empty pile draws at its anchor. */
function drawEmptyPiles(ctx: Ctx2D, state: DeepReadonly<CascadeState>): void {
  if (state.stock.length === 0) {
    const anchor = pileAnchor("stock", 0);
    drawEmptySlot(ctx, anchor.x, anchor.y);
  }
  // A waste whose set memory is empty shows no card, so it draws the mark
  // whatever cards it still holds (specs/table.md).
  if (wasteShownCount(state) === 0) {
    const anchor = pileAnchor("waste", 0);
    drawEmptySlot(ctx, anchor.x, anchor.y);
  }
  for (let i = 0; i < FOUNDATION_COUNT; i++) {
    if ((state.foundations[i] ?? []).length > 0) continue;
    const anchor = pileAnchor("foundation", i);
    drawEmptySlot(ctx, anchor.x, anchor.y);
  }
  for (let i = 0; i < TABLEAU_COLUMNS; i++) {
    if ((state.tableau[i] ?? []).length > 0) continue;
    const anchor = pileAnchor("tableau", i);
    drawEmptySlot(ctx, anchor.x, anchor.y);
  }
}

/** Every card on the table, in the order the layout draws them. */
function drawPiles(ctx: Ctx2D, state: DeepReadonly<CascadeState>): void {
  for (const placed of drawnCards(state)) {
    drawCard(ctx, placed.x, placed.y, placed.card);
  }
}

/** The mark on the pile a release would land the held run on. */
function drawDropTarget(ctx: Ctx2D, state: DeepReadonly<CascadeState>): void {
  const target = state.dropTarget;
  if (target === null) return;
  const rect = dropRect(state, target.pile, target.index);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 6;
  ctx.strokeRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6);
}

/** The run in hand, drawn above every pile it passes over. */
function drawHeldRun(ctx: Ctx2D, state: DeepReadonly<CascadeState>): void {
  const drag = state.drag;
  if (drag === null) return;
  drag.cards.forEach((card, i) => {
    const x = drag.x;
    const y = drag.y + i * FACE_UP_OFFSET;
    drawCard(ctx, x, y, card);
    ctx.strokeStyle = COLOR.highlight;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, CARD_W - 4, CARD_H - 4);
  });
}

/** The strip along the bottom: three controls and the deal-mode label. */
function drawHud(
  ctx: Ctx2D,
  width: number,
  state: DeepReadonly<CascadeState>,
): void {
  ctx.fillStyle = COLOR.hudBar;
  ctx.fillRect(0, HUD_Y, width, HUD_H);

  const rects: readonly Rect[] = [HUD_NEW_GAME, HUD_MENU, HUD_SOUND];
  rects.forEach((rect, i) => {
    const selected = state.menuIndex === i;
    plate(
      ctx,
      rect,
      COLOR.hudKey,
      selected ? COLOR.highlight : COLOR.panelLine,
    );
    labelled(ctx, rect, HUD_ITEMS[i] ?? "", 17, selected);
  });

  text(ctx, DEAL_MODE_LABEL, width - 24, HUD_Y + HUD_H / 2, {
    size: 17,
    color: COLOR.textDim,
    weight: "bold",
    align: "right",
  });
}

/** The live table. */
function drawPlaying(
  ctx: Ctx2D,
  state: DeepReadonly<CascadeState>,
  width: number,
  height: number,
): void {
  drawFelt(ctx, width, height);
  state.trail.blit(ctx);
  drawEmptyPiles(ctx, state);
  drawPiles(ctx, state);
  drawDropTarget(ctx, state);
  drawHeldRun(ctx, state);
  drawHud(ctx, width, state);
}

/** The opening screen. */
function drawTitle(
  ctx: Ctx2D,
  width: number,
  height: number,
  state: DeepReadonly<CascadeState>,
): void {
  drawFelt(ctx, width, height);

  ctx.fillStyle = COLOR.feltShade;
  ctx.fillRect(0, 120, width, 260);

  text(ctx, TITLE_TEXT, width / 2, 224, { size: 92, weight: "bold" });
  text(ctx, TAGLINE_TEXT, width / 2, 300, {
    size: 26,
    color: COLOR.textDim,
    weight: "bold",
  });
  text(ctx, DEAL_MODE_LABEL, width / 2, 404, {
    size: 22,
    color: COLOR.textDim,
    weight: "bold",
  });

  const items: readonly Rect[] = [TITLE_NEW_GAME, TITLE_HOW_TO];
  items.forEach((rect, i) => {
    const selected = state.menuIndex === i;
    plate(ctx, rect, COLOR.panel, selected ? COLOR.highlight : COLOR.panelLine);
    labelled(ctx, rect, TITLE_ITEMS[i] ?? "", 24, selected);
  });
}

/** How to play. */
function drawHowTo(
  ctx: Ctx2D,
  width: number,
  height: number,
  state: DeepReadonly<CascadeState>,
): void {
  drawFelt(ctx, width, height);

  text(ctx, "HOW TO PLAY", width / 2, 96, { size: 48, weight: "bold" });

  plate(
    ctx,
    { x: 160, y: 150, w: width - 320, h: 400 },
    COLOR.panel,
    COLOR.panelLine,
  );
  HOWTO_LINES.forEach((line, i) => {
    if (line === "") return;
    text(ctx, line, 200, 194 + i * 32, {
      size: 21,
      align: "left",
    });
  });

  // The screen's only item, so it is always the selected one.
  const selected = state.menuIndex === 0;
  plate(
    ctx,
    HOWTO_BACK,
    COLOR.hudKey,
    selected ? COLOR.highlight : COLOR.panelLine,
  );
  labelled(ctx, HOWTO_BACK, HOWTO_BACK_LABEL, 24, selected);
}

/** The victory cascade, and the message that follows it. */
function drawWon(
  ctx: Ctx2D,
  state: DeepReadonly<CascadeState>,
  width: number,
  height: number,
): void {
  drawFelt(ctx, width, height);

  // The painted layer lies beneath the cards still on the foundations, beneath
  // the cards in flight, and beneath the message (specs/victory.md).
  state.trail.blit(ctx);

  for (const placed of drawnCards(state)) {
    drawCard(ctx, placed.x, placed.y, placed.card);
  }
  for (const flyer of state.flyers) {
    drawCardFace(ctx, flyer.x, flyer.y, flyer.suit, flyer.rank);
  }

  if (!state.cascadeDone) return;
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fillRect(width / 2 - 260, 268, 520, 152);
  text(ctx, WIN_TEXT, width / 2, 344, { size: 96, weight: "bold" });
}

/** Draw the whole frame. */
export function renderGame(
  state: DeepReadonly<CascadeState>,
  ctx: Ctx2D,
  width: number = STAGE_W,
  height: number = STAGE_H,
): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx, width, height, state);
      return;
    case "howto":
      drawHowTo(ctx, width, height, state);
      return;
    case "playing":
      drawPlaying(ctx, state, width, height);
      return;
    case "won":
      drawWon(ctx, state, width, height);
      return;
  }
}
