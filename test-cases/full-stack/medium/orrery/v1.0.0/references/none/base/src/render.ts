// Orrery — drawing the frame.
//
// Everything here is in the stage's logical units: the runtime has already put
// the canvas into the letterboxed transform, so a hex center drawn at
// `hexX(q, r)` lands where the pointer targets it.
//
// SEAM: the presentation phase of this build draws the machine, the motes and
// their filaments, the tray, the tape panel, the readout, the title, how-to and
// select screens, the solved panel and the fault display, over the produced
// sprites of specs/assets.md. What is here now is the ground everything else is
// drawn onto — the sky, the ninety-one cells of specs/field.md, and the
// editor's five regions of specs/editor.md — plus enough text on every screen
// to read where the game is.

import {
  HEADING_H,
  READOUT_X0,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TAPE_Y0,
  TITLE_ITEMS,
  TITLE_TEXT,
  TRAY_REGION_W,
} from "./constants";
import { challengesOf } from "./challenges";
import { hexPath, text } from "./draw";
import type { Game } from "./game";
import { fieldHexes, hexX, hexY } from "./hex";
import { HEX_PITCH } from "./constants";
import { COLORS } from "./theme";
import type { OrreryState } from "./types";

/** Draw the whole frame the state describes. */
export function render(ctx: CanvasRenderingContext2D, game: Game): void {
  const { state } = game;
  ctx.save();
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      break;
    case "howto":
      drawHowto(ctx, state);
      break;
    case "select":
      drawSelect(ctx, state);
      break;
    case "editor":
      drawEditor(ctx, game);
      break;
  }
  ctx.restore();
}

function drawTitle(ctx: CanvasRenderingContext2D, state: OrreryState): void {
  text(ctx, TITLE_TEXT, STAGE_CX, 200, {
    size: 72,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 12,
  });
  text(ctx, TAGLINE_TEXT, STAGE_CX, 244, {
    size: 16,
    color: COLORS.textDim,
    align: "center",
    spacing: 5,
  });
  TITLE_ITEMS.forEach((item, index) => {
    const selected = index === state.menuIndex;
    text(ctx, item, STAGE_CX, 360 + index * 44, {
      size: 22,
      color: selected ? COLORS.brass : COLORS.textDim,
      bold: selected,
      align: "center",
      spacing: 4,
    });
  });
}

function drawHowto(ctx: CanvasRenderingContext2D, state: OrreryState): void {
  text(ctx, "HOW TO PLAY", STAGE_CX, 120, {
    size: 34,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 6,
  });
  text(ctx, HOWTO_HEADINGS[state.howtoPage] ?? "", STAGE_CX, 200, {
    size: 22,
    color: COLORS.text,
    align: "center",
  });
  text(
    ctx,
    `${state.howtoPage + 1} / ${HOWTO_HEADINGS.length}`,
    STAGE_CX,
    620,
    {
      size: 14,
      color: COLORS.textFaint,
      align: "center",
    },
  );
}

/** The five how-to pages, in the order specs/ui.md fixes. */
const HOWTO_HEADINGS: readonly string[] = [
  "The sky",
  "The machine",
  "The tape",
  "Running",
  "Finishing",
];

function drawSelect(ctx: CanvasRenderingContext2D, state: OrreryState): void {
  const list = challengesOf(state.mode);
  text(ctx, state.mode.toUpperCase(), STAGE_CX, 100, {
    size: 30,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 6,
  });
  list.forEach((challenge, index) => {
    const selected = index === state.selectIndex;
    text(ctx, `${index + 1}. ${challenge.name}`, STAGE_CX, 170 + index * 34, {
      size: 20,
      color: selected ? COLORS.brass : COLORS.textDim,
      bold: selected,
      align: "center",
    });
  });
}

function drawEditor(ctx: CanvasRenderingContext2D, game: Game): void {
  const { state } = game;
  // The editor's five regions (specs/editor.md "Layout").
  ctx.save();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    0.5,
    HEADING_H + 0.5,
    TRAY_REGION_W - 1,
    STAGE_H - HEADING_H - 1,
  );
  ctx.strokeRect(
    READOUT_X0 + 0.5,
    HEADING_H + 0.5,
    STAGE_W - READOUT_X0 - 1,
    TAPE_Y0 - HEADING_H - 1,
  );
  ctx.strokeRect(
    TRAY_REGION_W + 0.5,
    TAPE_Y0 + 0.5,
    STAGE_W - TRAY_REGION_W - 1,
    STAGE_H - TAPE_Y0 - 1,
  );
  ctx.beginPath();
  ctx.moveTo(0, HEADING_H + 0.5);
  ctx.lineTo(STAGE_W, HEADING_H + 0.5);
  ctx.stroke();
  ctx.restore();

  drawField(ctx);

  text(ctx, state.challenge?.name ?? "", 16, 32, {
    size: 20,
    color: COLORS.text,
  });
}

/** The field's ninety-one cells, drawn at their fixed geometry. */
export function drawField(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (const cell of fieldHexes()) {
    hexPath(ctx, hexX(cell.q, cell.r), hexY(cell.q, cell.r), HEX_PITCH / 2);
    ctx.fillStyle = COLORS.hex;
    ctx.fill();
    ctx.strokeStyle = COLORS.hexEdge;
    ctx.stroke();
  }
  ctx.restore();
}
