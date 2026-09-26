// Orrery — drawing the tape panel (specs/editor.md "The tape panel").
//
// One row per arm and wheel, in placement order, at the fixed geometry
// `src/tapepanel.ts` computes: five rows, forty columns, and two scroll
// positions derived from the cursor rather than stored. A row's label carries
// the identifier that is also drawn on that part on the field, and the row's
// own tape length against the machine's period, so a player can see at a
// glance which tape is setting the period every other tape loops on.
//
// A cell shows its instruction as the produced glyph, drawn at its native
// `INSTRUCTION_GLYPH_SIZE` (24) in a `TAPE_CELL_W` (24) cell — nothing is
// scaled — and a blank cell is drawn empty. When a glyph is unavailable the
// instruction's own initials are drawn instead, so the tape stays readable.

import {
  INSTRUCTION_GLYPH_PATHS,
  INSTRUCTION_GLYPH_SIZE,
  STAGE_H,
  STAGE_W,
  TAPE_CELL_W,
  TAPE_COLS_VISIBLE,
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { fillRect, sprite, strokeRect, text } from "./draw";
import type { Sprites } from "./assets";
import { rowLabel } from "./labels";
import { machinePeriod, tapeLength, tapeRows } from "./machine";
import {
  tapeCellRect,
  tapeFirstCol,
  tapeFirstRow,
  tapeLabelRect,
  tapeRowRect,
} from "./tapepanel";
import { COLORS } from "./theme";
import type { Instruction } from "./types";
import type { OrreryState } from "./state";

/** Two letters that tell each instruction apart when its glyph is missing. */
const INSTRUCTION_TAGS: Record<Instruction, string> = {
  grab: "GR",
  drop: "DR",
  "rotate-cw": "R+",
  "rotate-ccw": "R-",
  "pivot-cw": "P+",
  "pivot-ccw": "P-",
  extend: "EX",
  retract: "RE",
  advance: "AD",
  recede: "RC",
};

/** Draw the whole tape panel: its ground, its rows, its cells, and the cursor. */
export function drawTapePanel(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
): void {
  const editor = state.editor;
  fillRect(
    ctx,
    TRAY_REGION_W,
    TAPE_Y0,
    STAGE_W - TRAY_REGION_W,
    STAGE_H - TAPE_Y0,
    COLORS.panel,
  );
  strokeRect(
    ctx,
    TRAY_REGION_W,
    TAPE_Y0,
    STAGE_W - TRAY_REGION_W,
    STAGE_H - TAPE_Y0,
    editor.focus === "tape" ? COLORS.brass : COLORS.panelEdge,
    editor.focus === "tape" ? 2 : 1,
  );

  const rows = tapeRows(editor.parts);
  const period = machinePeriod(editor.parts);
  const firstRow = tapeFirstRow(editor.parts, editor.cursor);
  const firstCol = tapeFirstCol(editor.cursor);

  if (rows.length === 0) {
    text(ctx, "no arm placed", TRAY_REGION_W + 12, TAPE_Y0 + 20, {
      size: 12,
      color: COLORS.textFaint,
    });
    return;
  }

  for (let v = 0; v < TAPE_ROWS_VISIBLE; v += 1) {
    const index = firstRow + v;
    const part = rows[index];
    if (part === undefined) continue;
    const band = tapeRowRect(v);
    if (v % 2 === 1) {
      fillRect(
        ctx,
        band.x0,
        band.y0,
        band.x1 - band.x0,
        TAPE_ROW_H,
        COLORS.sky,
      );
    }
    drawLabel(
      ctx,
      v,
      index,
      part.tape === null ? 0 : tapeLength(part.tape),
      period,
    );
    for (let u = 0; u < TAPE_COLS_VISIBLE; u += 1) {
      const col = firstCol + u;
      const cell = tapeCellRect(v, u);
      const instruction = part.tape?.[col] ?? null;
      strokeRect(
        ctx,
        cell.x0,
        cell.y0 + 2,
        TAPE_CELL_W,
        TAPE_ROW_H - 4,
        col < (part.tape?.length ?? 0) ? COLORS.panelEdge : COLORS.sky,
      );
      if (instruction !== null) {
        const at = {
          x: cell.x0 + TAPE_CELL_W / 2,
          y: cell.y0 + TAPE_ROW_H / 2,
        };
        if (
          !sprite(
            ctx,
            sprites.get(INSTRUCTION_GLYPH_PATHS[instruction]),
            at.x,
            at.y,
            INSTRUCTION_GLYPH_SIZE,
          )
        ) {
          text(ctx, INSTRUCTION_TAGS[instruction], at.x, at.y + 4, {
            size: 11,
            color: COLORS.brass,
            align: "center",
            bold: true,
          });
        }
      }
      const cursor = editor.cursor;
      if (cursor !== null && cursor.part === part.id && cursor.col === col) {
        strokeRect(
          ctx,
          cell.x0,
          cell.y0 + 1,
          TAPE_CELL_W,
          TAPE_ROW_H - 2,
          COLORS.brass,
          2,
        );
      }
    }
  }

  if (rows.length > TAPE_ROWS_VISIBLE) {
    text(
      ctx,
      `rows ${firstRow + 1}-${Math.min(rows.length, firstRow + TAPE_ROWS_VISIBLE)} of ${rows.length}`,
      STAGE_W - 8,
      STAGE_H - 4,
      { size: 9, color: COLORS.textFaint, align: "right" },
    );
  }
}

/** One row's label: its identifier, and its tape length against the period. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  visible: number,
  index: number,
  length: number,
  period: number,
): void {
  const rect = tapeLabelRect(visible);
  text(ctx, rowLabel(index), rect.x0 + 8, rect.y0 + 19, {
    size: 15,
    color: COLORS.brass,
    bold: true,
  });
  text(ctx, `${length}/${period}`, rect.x1 - 6, rect.y0 + 18, {
    size: 10,
    color: length === period ? COLORS.text : COLORS.textFaint,
    align: "right",
  });
}
