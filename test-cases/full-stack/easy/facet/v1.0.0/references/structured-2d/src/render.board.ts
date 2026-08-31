// Facet — drawing the board: the bench it sits on, the stones on it, the marks
// the player reads, and the effects a chain throws.
//
// The bench is a produced sprite (`gems/frame.png`), and `src/theme.ts` places
// it so that its felt field lands exactly on the cell centers `specs/board.md`
// fixes — 576 units of field around centers running x 388..892 and y 144..648,
// with an 36-unit bench surround. Nothing here recomputes that geometry; the
// centers all come from the core's `cellCenter`.
//
// The three marks are drawn in code (specs/assets.md: there is no `ui` tool),
// and each is a different SHAPE as well as a different color, so they are told
// apart on a board of seven hues: the cursor is four corner brackets, the
// selection is a full ring, and a refusal is a cross on each of the two cells
// that did not trade.
//
// The draw order is the reading order: the wash, the bench, the stones, the
// shatters over the stones that fell into their place, the bursts over
// everything, and the marks on top so they are never lost under an effect.

import { FRAME_KEY, type AssetStore } from "./assets";
import {
  CELL_PITCH,
  GEM_R,
  GRID_COLS,
  GRID_ROWS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { cellCenter } from "./core";
import { gemAtCell } from "./bridge";
import type { CellRef, FacetState } from "./game";
import type { Presentation } from "./effects";
import { drawGem } from "./render.gems";
import { COLOR, FRAME_SIZE, FRAME_X, FRAME_Y, roundedRect } from "./theme";

/** The wash behind everything: a pool of light centered on the stage. */
export function drawField(ctx: CanvasRenderingContext2D): void {
  const glow = ctx.createRadialGradient(
    STAGE_CX,
    STAGE_CY,
    40,
    STAGE_CX,
    STAGE_CY,
    STAGE_W * 0.55,
  );
  glow.addColorStop(0, COLOR.glowInner);
  glow.addColorStop(1, COLOR.glowOuter);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/**
 * The bench the field sits on. The produced frame is drawn at native size; a
 * frame that has not arrived yet leaves a plain felt rectangle with the eight
 * by eight division ruled on it, so the board still reads as a grid.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
): void {
  const frame = assets.image(FRAME_KEY);
  if (frame !== null) {
    ctx.drawImage(frame, FRAME_X, FRAME_Y, FRAME_SIZE, FRAME_SIZE);
    return;
  }
  const fieldX = FRAME_X + (FRAME_SIZE - GRID_COLS * CELL_PITCH) / 2;
  const fieldY = FRAME_Y + (FRAME_SIZE - GRID_ROWS * CELL_PITCH) / 2;
  ctx.fillStyle = "#161a26";
  roundedRect(
    ctx,
    fieldX,
    fieldY,
    GRID_COLS * CELL_PITCH,
    GRID_ROWS * CELL_PITCH,
    8,
  );
  ctx.fill();
  ctx.strokeStyle = "rgba(246, 198, 106, 0.18)";
  ctx.lineWidth = 1;
  for (let col = 1; col < GRID_COLS; col += 1) {
    ctx.beginPath();
    ctx.moveTo(fieldX + col * CELL_PITCH, fieldY);
    ctx.lineTo(fieldX + col * CELL_PITCH, fieldY + GRID_ROWS * CELL_PITCH);
    ctx.stroke();
  }
  for (let row = 1; row < GRID_ROWS; row += 1) {
    ctx.beginPath();
    ctx.moveTo(fieldX, fieldY + row * CELL_PITCH);
    ctx.lineTo(fieldX + GRID_COLS * CELL_PITCH, fieldY + row * CELL_PITCH);
    ctx.stroke();
  }
}

/** Every gem on the board, each at its own cell center. */
export function drawGems(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
): void {
  for (let row = 0; row < state.board.rows; row += 1) {
    for (let col = 0; col < state.board.cols; col += 1) {
      const gem = gemAtCell(state.board, col, row);
      if (gem === null) continue;
      const [x, y] = cellCenter({ col, row });
      drawGem(ctx, assets, gem, x, y, state.simTime);
    }
  }
}

/** Four corner brackets around a cell: the keyboard cursor. */
function drawCursorMark(ctx: CanvasRenderingContext2D, cell: CellRef): void {
  const [x, y] = cellCenter(cell);
  const half = CELL_PITCH / 2 - 4;
  const arm = 12;
  ctx.strokeStyle = COLOR.cursor;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = x + sx * half;
      const cy = y + sy * half;
      ctx.beginPath();
      ctx.moveTo(cx - sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy - sy * arm);
      ctx.stroke();
    }
  }
}

/** A full ring, pulsing gently on game time: the selected cell. */
function drawSelectionMark(
  ctx: CanvasRenderingContext2D,
  cell: CellRef,
  simTime: number,
): void {
  const [x, y] = cellCenter(cell);
  const pulse = 0.5 + 0.5 * Math.sin(simTime * 5);
  ctx.save();
  ctx.strokeStyle = COLOR.selection;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.65 + 0.35 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, GEM_R + 4 + pulse * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.14 + 0.1 * pulse;
  ctx.fillStyle = COLOR.selection;
  ctx.fill();
  ctx.restore();
}

/** A cross on each of the two cells a refused swap named. */
function drawRefusalMark(ctx: CanvasRenderingContext2D, cell: CellRef): void {
  const [x, y] = cellCenter(cell);
  const arm = GEM_R - 4;
  ctx.strokeStyle = COLOR.refusal;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - arm, y - arm);
  ctx.lineTo(x + arm, y + arm);
  ctx.moveTo(x + arm, y - arm);
  ctx.lineTo(x - arm, y + arm);
  ctx.stroke();
}

/** The cursor, the selection, and any standing refusal. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  drawCursorMark(ctx, state.cursor);
  if (state.selection) drawSelectionMark(ctx, state.selection, state.simTime);
  if (state.refusal) {
    drawRefusalMark(ctx, state.refusal.a);
    drawRefusalMark(ctx, state.refusal.b);
  }
  ctx.restore();
}

/** The whole board: the bench, the stones, the effects, and the marks. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  presentation: Presentation,
): void {
  drawFrame(ctx, assets);
  drawGems(ctx, assets, state);
  presentation.drawBreaks(ctx, assets);
  presentation.drawBursts(ctx);
  drawMarks(ctx, state);
}
