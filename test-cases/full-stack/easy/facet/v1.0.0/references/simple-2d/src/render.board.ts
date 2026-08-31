// Facet — drawing the board: the bench it sits on, the stones on it and the
// motion they are in, the marks the player reads, and the effects a chain throws.
//
// The bench is a produced sprite (`gems/frame.png`), and `src/theme.ts` places
// it so that its felt field lands exactly on the cell centers `specs/board.md`
// fixes — 576 units of field around centers running x 388..892 and y 144..648,
// with a 36-unit bench surround. Nothing here recomputes that geometry; the
// centers all come from the core's `cellCenter`.
//
// THE BOARD IS DRAWN IN MOTION, and `specs/rules.md` fixes every span of it.
// Three things move, and each is read straight off the state rather than
// remembered:
//
//   * AN ACCEPTED SWAP. While `phase` is `swapping` the two exchanged gems are
//     already in the cells they are headed for, so each is drawn back along the
//     line from the cell it came from, `swapTimer / SWAP_SECONDS` of the way
//     across.
//   * A FALL. Every gem carries `fell`, the rows it traveled to reach its cell
//     (R9), and a step's gems begin falling once its clear set has finished
//     shattering — `lastWaves * WAVE_SECONDS` into the step — each taking
//     `fell * FALL_SECONDS_PER_ROW` to arrive. A gem drawn from `row - fell`
//     enters from above the board's top row when that is negative, which is
//     exactly where a refill comes from.
//   * AN OFFER. While one stands, the gem the player has hold of and the gem it
//     is offered into are drawn exchanged, so the move a release would play is
//     the move on the screen.
//
// A board that arrives with no chain step to time it — a fresh deal, the next
// level — pours in on the presentation's own clock, which is the one figure
// `src/effects.ts` holds for the purpose. Every gem of such a board carries a
// `fell` of at least `row + 1`, so the pour needs nothing else.
//
// The two marks are drawn in code (specs/assets.md: there is no `ui` tool), and
// each is a different SHAPE as well as a different color, so they are told
// apart on a board of seven hues: the selection is a full ring and a refusal is
// a cross on each of the two cells that did not trade.
//
// The draw order is the reading order: the wash, the bench, the stones, the
// auras over the cut stones they belong to, the shatters over the stones that
// fell into their place, the bursts over everything, and the marks on top so
// they are never lost under an effect.

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
import {
  cellCenter,
  cellY,
  gemAt,
  sameCell,
  type Cell,
  type CellPair,
  type FacetState,
  type Gem,
} from "./core";
import { Presentation } from "./effects";
import { drawGem } from "./render.gems";
import { COLOR, FRAME_SIZE, FRAME_X, FRAME_Y, roundedRect } from "./theme";

/** The felt field the stones stand on: the grid, plus half a pitch all round. */
export const FIELD_X = FRAME_X + (FRAME_SIZE - GRID_COLS * CELL_PITCH) / 2;
export const FIELD_Y = FRAME_Y + (FRAME_SIZE - GRID_ROWS * CELL_PITCH) / 2;
export const FIELD_W = GRID_COLS * CELL_PITCH;
export const FIELD_H = GRID_ROWS * CELL_PITCH;

/** What the board is doing this frame, which is what places each gem. */
export interface BoardMotion {
  /** The pair in flight and how far across it is, or `null` for a still board. */
  readonly swap: { readonly pair: CellPair; readonly t: number } | null;
  /** How long the gems have been falling, or `null` while none is falling. */
  readonly falling: number | null;
}

/**
 * The board's motion this frame, read off the state and the presentation's pour
 * clock. A step in progress times its own fall from the end of its shattering;
 * a board no step explains falls on the pour clock instead.
 */
export function boardMotion(
  state: FacetState,
  pourAge: number | null,
): BoardMotion {
  const swap =
    state.phase === "swapping" && state.chainSwap !== null
      ? {
          pair: state.chainSwap,
          t: Math.min(1, Math.max(0, state.swapTimer / SWAP_SECONDS)),
        }
      : null;
  const falling =
    state.phase === "resolving"
      ? state.stepTimer - state.lastWaves * WAVE_SECONDS
      : pourAge;
  return { swap, falling };
}

/**
 * Where one cell's gem is drawn: its cell center once it is at rest, and a
 * point between two cells while the swap or the fall that put it there is still
 * running.
 */
export function gemPosition(
  cell: Cell,
  gem: Gem,
  motion: BoardMotion,
): readonly [number, number] {
  const [x, y] = cellCenter(cell);
  if (motion.swap !== null) {
    const { pair, t } = motion.swap;
    const from = sameCell(cell, pair.a)
      ? pair.b
      : sameCell(cell, pair.b)
        ? pair.a
        : null;
    if (from !== null) {
      const [fromX, fromY] = cellCenter(from);
      return [fromX + (x - fromX) * t, fromY + (y - fromY) * t];
    }
  }
  if (motion.falling !== null && gem.fell > 0) {
    const span = gem.fell * FALL_SECONDS_PER_ROW;
    const t = Math.min(1, Math.max(0, motion.falling / span));
    if (t < 1) {
      const fromY = cellY(cell.row - gem.fell);
      return [x, fromY + (y - fromY) * t];
    }
  }
  return [x, y];
}

/**
 * The gem drawn in a cell, which is the gem standing in it — except while an
 * offer stands, where the held gem and the offered one are drawn exchanged so a
 * player sees the move a release would play (specs/ui.md).
 */
export function gemForCell(state: FacetState, cell: Cell): Gem | null {
  const selection = state.selection;
  const offer = state.offer;
  if (selection !== null && offer !== null) {
    if (sameCell(cell, selection)) return gemAt(state.board, offer);
    if (sameCell(cell, offer)) return gemAt(state.board, selection);
  }
  return gemAt(state.board, cell);
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
  ctx.fillStyle = "#161a26";
  roundedRect(ctx, FIELD_X, FIELD_Y, FIELD_W, FIELD_H, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(246, 198, 106, 0.18)";
  ctx.lineWidth = 1;
  for (let col = 1; col < GRID_COLS; col += 1) {
    ctx.beginPath();
    ctx.moveTo(FIELD_X + col * CELL_PITCH, FIELD_Y);
    ctx.lineTo(FIELD_X + col * CELL_PITCH, FIELD_Y + FIELD_H);
    ctx.stroke();
  }
  for (let row = 1; row < GRID_ROWS; row += 1) {
    ctx.beginPath();
    ctx.moveTo(FIELD_X, FIELD_Y + row * CELL_PITCH);
    ctx.lineTo(FIELD_X + FIELD_W, FIELD_Y + row * CELL_PITCH);
    ctx.stroke();
  }
}

/**
 * Every gem on the board, each wherever this frame's motion puts it, clipped to
 * the felt field so a stone still on its way in enters over the field's top
 * edge rather than over the readouts.
 */
export function drawGems(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  motion: BoardMotion,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
  ctx.clip();
  for (let row = 0; row < state.board.rows; row += 1) {
    for (let col = 0; col < state.board.cols; col += 1) {
      const cell = { col, row };
      const gem = gemForCell(state, cell);
      if (gem === null) continue;
      const [x, y] = gemPosition(cell, gem, motion);
      drawGem(ctx, assets, gem, x, y, state.simTime);
    }
  }
  ctx.restore();
}

/** A full ring, pulsing gently on game time: the cell the player has hold of. */
function drawSelectionMark(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
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

/** A square around the cell the held gem is currently offered into. */
function drawOfferMark(ctx: CanvasRenderingContext2D, cell: Cell): void {
  const [x, y] = cellCenter(cell);
  const half = CELL_PITCH / 2 - 4;
  ctx.save();
  ctx.strokeStyle = COLOR.offer;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 7]);
  roundedRect(ctx, x - half, y - half, half * 2, half * 2, 8);
  ctx.stroke();
  ctx.restore();
}

/** A cross on each of the two cells a refused swap named. */
function drawRefusalMark(ctx: CanvasRenderingContext2D, cell: Cell): void {
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

/** The selection, the offer it stands over, and any standing refusal. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  if (state.selection) drawSelectionMark(ctx, state.selection, state.simTime);
  if (state.offer) drawOfferMark(ctx, state.offer);
  if (state.refusal) {
    drawRefusalMark(ctx, state.refusal.a);
    drawRefusalMark(ctx, state.refusal.b);
  }
  ctx.restore();
}

/** The whole board: the bench, the stones, the auras, the effects, the marks. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  presentation: Presentation,
): void {
  const motion = boardMotion(state, presentation.pourAge());
  drawFrame(ctx, assets);
  drawGems(ctx, assets, state, motion);
  // The auras go OVER the stones they belong to, so a cut stone reads as one
  // that is never still rather than as one with a halo behind it; they are
  // clipped to the bench, which no aura's field reaches the edge of.
  ctx.save();
  ctx.beginPath();
  ctx.rect(FRAME_X, FRAME_Y, FRAME_SIZE, FRAME_SIZE);
  ctx.clip();
  presentation.drawAuras(ctx, (cell) => {
    const gem = gemAt(state.board, cell);
    return gem === null ? cellCenter(cell) : gemPosition(cell, gem, motion);
  });
  ctx.restore();
  presentation.drawBreaks(ctx, assets);
  presentation.drawBursts(ctx);
  drawMarks(ctx, state);
}
