// Cascade — all of the drawing.
//
// Every function here reads the state and draws; none of them writes to it, so
// a frame's outcome is decided entirely by its update and the picture is a pure
// function of what that update left behind.
//
// The context arrives already cleared to the felt and already carrying the
// logical transform, so everything below is written in the stage's own units
// and never looks at the window (`specs/overview.md`).
//
// TEXT IS DRAWN ONE RUN AT A TIME. Every literal `specs/screens.md` fixes is
// one `fillText` of exactly that string: the words a player reads and the words
// a reader of the drawing sees are the same words.

import {
  drawCardOn,
  drawHighlight,
  drawLiftedCard,
  drawSlot,
  roundRectPath,
} from "./cards";
import {
  COLUMN_X,
  DEAL_MODE_LABEL,
  FACE_UP_OFFSET,
  FOUNDATION_COUNT,
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
  TABLEAU_COLUMNS,
  TABLEAU_Y,
  TAGLINE_TEXT,
  TITLE_HOW_TO,
  TITLE_ITEMS,
  TITLE_NEW_GAME,
  TITLE_TEXT,
  TOP_ROW_Y,
  WASTE_X,
  WIN_TEXT,
} from "./constants";
import { wasteVisibleCount } from "./board";
import type { CascadeState } from "./state";
import {
  columnCardYs,
  columnDropRect,
  foundationRect,
  hudStrip,
} from "./table";
import { COLOR, SUIT_GLYPH, UI_FONT } from "./theme";
import type { Card, Rect } from "./types";

/** The dim pip an empty foundation carries, one per slot. */
const FOUNDATION_HINTS = [
  SUIT_GLYPH.spades,
  SUIT_GLYPH.hearts,
  SUIT_GLYPH.diamonds,
  SUIT_GLYPH.clubs,
];

/** The how-to copy, each line drawn as one run of text. */
const HOWTO_LINES = [
  "Build all four foundations from ACE up to KING, one suit each.",
  "A column builds down in rank and alternates in colour, red on black.",
  "Only a KING, or a run led by one, fills a column you have emptied.",
  "Click the STOCK to turn a card onto the waste; click it empty to recycle.",
  "Drag a card or a run to move it, and DOUBLE-CLICK a card to send it home.",
] as const;

export function render(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  drawFelt(ctx);
  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      return;
    case "howto":
      drawHowTo(state, ctx);
      return;
    case "playing":
      drawTable(state, ctx);
      return;
    case "won":
      drawWon(state, ctx);
  }
}

function drawFelt(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.felt;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/* ---- The live table ------------------------------------------------------ */

function drawTable(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  drawTopRow(state, ctx);
  drawColumns(state, ctx);
  drawDropTarget(state, ctx);
  drawHud(state, ctx);
  drawHeldRun(state, ctx);
}

function drawTopRow(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  // The stock shows its top card, or an empty slot carrying the recycle mark
  // while the waste still holds cards to come back.
  if (state.stock.length > 0) {
    drawCardOn(ctx, state.stock[state.stock.length - 1], STOCK_X, TOP_ROW_Y);
  } else {
    drawSlot(ctx, STOCK_X, TOP_ROW_Y, state.waste.length > 0 ? "↻" : undefined);
  }

  drawWaste(state, ctx);

  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    const foundation = state.foundations[i];
    if (foundation.length > 0) {
      drawCardOn(
        ctx,
        foundation[foundation.length - 1],
        FOUNDATION_X[i],
        TOP_ROW_Y,
      );
    } else {
      drawSlot(ctx, FOUNDATION_X[i], TOP_ROW_Y, FOUNDATION_HINTS[i]);
    }
  }
}

/**
 * The waste: the card it shows drawn at the anchor, with every other card it
 * holds squared away beneath it.
 *
 * A waste whose set memory is empty shows no card, so it draws the empty-slot
 * mark whatever cards it still holds (`specs/table.md`).
 */
function drawWaste(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  const shown = Math.min(wasteVisibleCount(state), state.waste.length);
  if (shown <= 0) {
    drawSlot(ctx, WASTE_X, TOP_ROW_Y);
    return;
  }
  for (const card of state.waste) {
    drawCardOn(ctx, card, WASTE_X, TOP_ROW_Y);
  }
}

function drawColumns(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  for (let index = 0; index < TABLEAU_COLUMNS; index += 1) {
    const column = state.tableau[index];
    if (column.length === 0) {
      drawSlot(ctx, COLUMN_X[index], TABLEAU_Y);
      continue;
    }
    const ys = columnCardYs(column);
    for (let row = 0; row < column.length; row += 1) {
      drawCardOn(ctx, column[row], COLUMN_X[index], ys[row]);
    }
  }
}

function drawDropTarget(
  state: CascadeState,
  ctx: CanvasRenderingContext2D,
): void {
  const target = state.dropTarget;
  if (target === null) return;
  const rect =
    target.pile === "foundation"
      ? foundationRect(target.index)
      : columnDropRect(target.index, state.tableau[target.index]);
  drawHighlight(ctx, rect.x, rect.y, rect.w, rect.h);
}

function drawHeldRun(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  const drag = state.drag;
  if (drag === null) return;
  drag.cards.forEach((card: Card, i: number) => {
    drawLiftedCard(ctx, card, drag.x, drag.y + i * FACE_UP_OFFSET);
  });
}

/* ---- The HUD ------------------------------------------------------------- */

function drawHud(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  const strip = hudStrip();
  ctx.save();
  ctx.fillStyle = "rgba(6, 44, 27, 0.72)";
  ctx.fillRect(strip.x, strip.y, strip.w, strip.h);
  ctx.restore();

  drawButton(ctx, HUD_NEW_GAME, HUD_ITEMS[0], state.menuIndex === 0);
  drawButton(ctx, HUD_MENU, HUD_ITEMS[1], state.menuIndex === 1);
  drawButton(ctx, HUD_SOUND, HUD_ITEMS[2], state.menuIndex === 2);

  // The deal-mode label lives in the strip too, so which deal is being played
  // is visible throughout play (`specs/screens.md`).
  const plate: Rect = { x: 760, y: HUD_Y, w: 200, h: HUD_H };
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
  ctx.fillStyle = COLOR.highlight;
  ctx.font = `700 16px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(DEAL_MODE_LABEL, plate.x + plate.w / 2, plate.y + plate.h / 2);
  ctx.restore();
}

/**
 * A control: a dark plate, a border, and its label inside its own rect.
 *
 * THE SELECTED ITEM IS DRAWN DISTINCTLY, which `specs/controls.md` requires of
 * every menu: "the selected item is drawn distinctly from the others".
 * Here that is a brighter border and a brighter label, which reads at the stage
 * size and costs the layout nothing.
 */
function drawButton(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  selected = false,
): void {
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  // The border and the label carry the selection. Its WIDTH is left alone, so
  // the plate's own ground stays readable right up to the edge and a label read
  // against it is read against the plate rather than against the marker.
  ctx.lineWidth = 2;
  ctx.strokeStyle = selected ? COLOR.highlight : COLOR.panelEdge;
  roundRectPath(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 6);
  ctx.stroke();
  ctx.fillStyle = selected ? COLOR.highlight : COLOR.text;
  ctx.font = `700 ${Math.min(20, Math.round(rect.h * 0.46))}px ${UI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.restore();
}

/* ---- The title ----------------------------------------------------------- */

function drawTitle(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  quietTable(ctx);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.text;
  ctx.font = `800 132px ${UI_FONT}`;
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, 250);

  ctx.fillStyle = COLOR.textDim;
  ctx.font = `26px ${UI_FONT}`;
  ctx.fillText(TAGLINE_TEXT, STAGE_W / 2, 336);

  // The deal-mode label, so a player sees which deal the game is played with.
  const badge: Rect = { x: 540, y: 372, w: 200, h: 40 };
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(badge.x, badge.y, badge.w, badge.h);
  ctx.fillStyle = COLOR.highlight;
  ctx.font = `700 18px ${UI_FONT}`;
  ctx.fillText(DEAL_MODE_LABEL, badge.x + badge.w / 2, badge.y + badge.h / 2);
  ctx.restore();

  drawButton(ctx, TITLE_NEW_GAME, TITLE_ITEMS[0], state.menuIndex === 0);
  drawButton(ctx, TITLE_HOW_TO, TITLE_ITEMS[1], state.menuIndex === 1);
}

/** Quiet whatever the table shows, so the words over it read cleanly. */
function quietTable(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLOR.screenWash;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.restore();
}

/* ---- How to play --------------------------------------------------------- */

function drawHowTo(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  quietTable(ctx);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.text;
  ctx.font = `800 56px ${UI_FONT}`;
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 120);

  ctx.fillStyle = COLOR.textDim;
  ctx.font = `22px ${UI_FONT}`;
  let y = 240;
  for (const line of HOWTO_LINES) {
    ctx.fillText(line, STAGE_W / 2, y);
    y += 48;
  }
  ctx.restore();

  // The screen's only item, so it is always the selected one.
  drawButton(ctx, HOWTO_BACK, HOWTO_BACK_LABEL, state.menuIndex === 0);
}

/* ---- The won screen and the cascade -------------------------------------- */

function drawWon(state: CascadeState, ctx: CanvasRenderingContext2D): void {
  // The table beneath, as it stands: everything but the foundations is empty by
  // the time the game is won.
  drawSlot(ctx, STOCK_X, TOP_ROW_Y);
  drawSlot(ctx, WASTE_X, TOP_ROW_Y);
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    drawSlot(ctx, FOUNDATION_X[i], TOP_ROW_Y, FOUNDATION_HINTS[i]);
  }
  for (let index = 0; index < TABLEAU_COLUMNS; index += 1) {
    if (state.tableau[index].length === 0) {
      drawSlot(ctx, COLUMN_X[index], TABLEAU_Y);
    }
  }

  // The painted layer, beneath the cards still on the foundations, the cards in
  // flight, and the message (`specs/victory.md`).
  const trail = state.trail;
  if (trail !== null) ctx.drawImage(trail.image, 0, 0, STAGE_W, STAGE_H);

  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    const foundation = state.foundations[i];
    if (foundation.length === 0) continue;
    drawCardOn(
      ctx,
      foundation[foundation.length - 1],
      FOUNDATION_X[i],
      TOP_ROW_Y,
    );
  }

  for (const flyer of state.flyers) {
    drawCardOn(
      ctx,
      { id: flyer.id, suit: flyer.suit, rank: flyer.rank, faceUp: true },
      flyer.x,
      flyer.y,
    );
  }

  if (state.cascadeDone) drawWinMessage(ctx);
}

function drawWinMessage(ctx: CanvasRenderingContext2D): void {
  const plate: Rect = { x: 390, y: 232, w: 500, h: 170 };
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.highlight;
  roundRectPath(ctx, plate.x + 2, plate.y + 2, plate.w - 4, plate.h - 4, 12);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.highlight;
  ctx.font = `800 68px ${UI_FONT}`;
  ctx.fillText(WIN_TEXT, plate.x + plate.w / 2, plate.y + 62);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `18px ${UI_FONT}`;
  ctx.fillText(
    "CLICK FOR A NEW GAME",
    plate.x + plate.w / 2,
    plate.y + plate.h - 46,
  );
  ctx.restore();
}
