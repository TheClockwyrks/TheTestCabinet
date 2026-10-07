// Facet — drawing the board: the bench it sits on, the stones on it, where each
// stone is at this instant, the marks the player reads, and the effects a chain
// throws.
//
// The bench is a produced sprite (`gems/frame.png`), and `src/theme.ts` places
// it so that its felt field lands exactly on the cell centers `specs/board.md`
// fixes — 576 units of field around centers running x 388..892 and y 144..648,
// with a 36-unit bench surround. Nothing here recomputes that geometry; the
// centers all come from the core's `cellCenter`.
//
// THE BOARD IS DRAWN IN MOTION, and `specs/rules.md` fixes the timeline exactly.
// `gemPosition` below is the whole of it, and it reads three things and nothing
// else: the state's own `swapTimer` and `stepTimer`, the `fell` every gem
// carries, and — for a board that was dealt rather than resolved — the
// presentation's pour clock, since a settled board's timers all read `0`. So a
// stone is where the specification's own arithmetic says it is, and pausing the
// game freezes it exactly where it stood.
//
// The two marks are drawn in code (specs/assets.md: there is no `ui` tool), and
// each is a different SHAPE as well as a different color, so they are told
// apart on a board of seven hues: the selection is a full ring, and a refusal is
// a cross on each of the two cells that did not trade.
//
// The draw order is the reading order: the wash, the bench, the stones, the
// auras the cut stones carry, the shatters over the stones falling through
// their place, the bursts over everything, and the marks on top so they are
// never lost under an effect.

import { FRAME_KEY, type AssetStore } from "./assets";
import {
  CELL_PITCH,
  FALL_SECONDS_PER_ROW,
  GEM_R,
  GRID_COLS,
  GRID_ROWS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "./constants";
import { cellCenter, cellY, sameCell, type Cell } from "./core";
import { gemAtCell } from "./bridge";
import type { CellRef, FacetState, GemState } from "./game";
import type { Presentation } from "./effects";
import { drawGem } from "./render.gems";
import {
  COLOR,
  FIELD_SIZE,
  FIELD_X,
  FIELD_Y,
  FRAME_SIZE,
  FRAME_X,
  FRAME_Y,
  roundedRect,
} from "./theme";

/** `a` to `b` at `t`, with `t` held inside `0..1`. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

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

// ---- Where a stone is at this instant (specs/rules.md) -------------------

/**
 * The cell the swap in motion is carrying the gem at `cell` out of, or `null`
 * when that gem is not one of the two travelling.
 *
 * An accepted swap exchanges its two cells the moment it is accepted and only
 * then waits out `SWAP_SECONDS`, so the gem standing at one end of the swap is
 * the gem that was standing at the other.
 */
function swapOrigin(state: FacetState, cell: Cell): CellRef | null {
  const swap = state.chainSwap;
  if (state.phase !== "swapping" || swap === null) return null;
  if (sameCell(swap.a, cell)) return swap.b;
  if (sameCell(swap.b, cell)) return swap.a;
  return null;
}

/**
 * Where the gem holding `(col, row)` is drawn, which is that cell's center once
 * it has come to rest.
 *
 * Three spans put it somewhere else, and `specs/rules.md` times all three:
 *
 *   * while `phase` is `"swapping"`, the two swapped gems travel between their
 *     two cells over `SWAP_SECONDS` of `swapTimer`;
 *   * while `phase` is `"resolving"`, a gem that fell `n` rows waits out the
 *     shattering — `lastWaves * WAVE_SECONDS` of `stepTimer` — and then takes
 *     `n * FALL_SECONDS_PER_ROW` to arrive from `n` rows above;
 *   * while a freshly dealt board is pouring, every gem of it does the same
 *     from the row its own `fell` puts it at, which is above the board's top
 *     row, off the presentation's pour clock.
 */
export function gemPosition(
  state: FacetState,
  presentation: Presentation,
  col: number,
  row: number,
): readonly [number, number] {
  const [x, y] = cellCenter({ col, row });

  const origin = swapOrigin(state, { col, row });
  if (origin !== null) {
    const [fromX, fromY] = cellCenter(origin);
    const t = state.swapTimer / SWAP_SECONDS;
    return [lerp(fromX, x, t), lerp(fromY, y, t)];
  }

  const fell = gemAtCell(state.board, col, row)?.fell ?? 0;
  if (fell <= 0) return [x, y];

  const pour = presentation.pourAge();
  const resolving = state.phase === "resolving";
  if (!resolving && pour === null) return [x, y];
  const elapsed = resolving ? state.stepTimer : (pour ?? 0);
  const shatterEnd = resolving ? state.lastWaves * WAVE_SECONDS : 0;
  const fallen = (elapsed - shatterEnd) / (fell * FALL_SECONDS_PER_ROW);
  return [x, lerp(cellY(row - fell), y, fallen)];
}

/**
 * The gem drawn at a cell, which is the gem the board holds there except while
 * an offer stands: the gem at `selection` and the gem at `offer` are drawn
 * exchanged, so a player sees the move a release would play before they commit
 * to it (specs/ui.md).
 */
export function drawnGem(state: FacetState, cell: Cell): GemState | null {
  const selection = state.selection;
  const offer = state.offer;
  if (selection !== null && offer !== null) {
    if (sameCell(selection, cell)) {
      return gemAtCell(state.board, offer.col, offer.row);
    }
    if (sameCell(offer, cell)) {
      return gemAtCell(state.board, selection.col, selection.row);
    }
  }
  return gemAtCell(state.board, cell.col, cell.row);
}

/** Every gem on the board, each where this instant puts it. */
export function drawGems(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  presentation: Presentation,
): void {
  for (let row = 0; row < state.board.rows; row += 1) {
    for (let col = 0; col < state.board.cols; col += 1) {
      const gem = drawnGem(state, { col, row });
      if (gem === null) continue;
      const [x, y] = gemPosition(state, presentation, col, row);
      drawGem(ctx, assets, gem, x, y, state.simTime);
    }
  }
}

/** A full ring, pulsing gently on game time: the cell the player has hold of. */
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

/** The selection, and any standing refusal. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  if (state.selection) drawSelectionMark(ctx, state.selection, state.simTime);
  if (state.refusal) {
    drawRefusalMark(ctx, state.refusal.a);
    drawRefusalMark(ctx, state.refusal.b);
  }
  ctx.restore();
}

/**
 * The whole board: the bench, the stones, the effects, and the marks.
 *
 * THE STONES ARE CLIPPED TO THE FELT FIELD and nothing else is. A stone R9
 * refilled comes from above the board's top row, so without the clip it would
 * be drawn over the bench and out across the readouts; with it, a falling
 * stone rises out of the bench's own edge the way it would on a real board.
 * The shatters, the bursts, and the marks are left unclipped, because a burst
 * throwing chips past the field's edge is the point of it.
 */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  presentation: Presentation,
): void {
  drawFrame(ctx, assets);
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_SIZE, FIELD_SIZE);
  ctx.clip();
  drawGems(ctx, assets, state, presentation);
  // An aura belongs to the stone rather than to the cell, so it is drawn where
  // the stone is drawn — falling or travelling through a swap included.
  presentation.drawAuras(ctx, (cell) =>
    gemPosition(state, presentation, cell.col, cell.row),
  );
  ctx.restore();
  presentation.drawBreaks(ctx, assets);
  presentation.drawBursts(ctx);
  drawMarks(ctx, state);
}
