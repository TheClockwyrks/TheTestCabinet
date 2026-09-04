// Facet — drawing the board: the bench it sits on, the stones on it and where
// they are at this instant, the marks the player reads, and the effects a chain
// throws.
//
// The bench is a produced sprite (`gems/frame.png`), and `src/theme.ts` places
// it so that its felt field lands exactly on the cell centers `specs/board.md`
// fixes — 576 units of field around centers running x 388..892 and y 144..648,
// with a 36-unit bench surround. Nothing here recomputes that geometry; the
// centers all come from the core's `cellCenter`.
//
// NOTHING ON THIS BOARD TELEPORTS. `src/motion.ts` says where each gem is drawn
// — travelling between its two cells while a swap is in motion, still short of
// its cell while it is falling, and standing in the cell it holds once it has
// arrived — and every mark, sprite, and aura is placed through that one
// function, so a gem, its cut aura, and the ring around it never come apart.
//
// While an offer stands, the gem at `selection` and the gem at `offer` are
// drawn in each other's cells and NOTHING on the board has moved: a release is
// what plays the move, so this is a player seeing the move before committing to
// it (specs/ui.md).
//
// The two marks are drawn in code (specs/assets.md: there is no `ui` tool), and
// each is a different SHAPE as well as a different color, so they are told
// apart on a board of seven hues: the selection is a full ring, the cell it is
// offered into a lighter one, and a refusal is a cross on each of the two cells
// that did not trade.
//
// The draw order is the reading order: the wash, the bench, the stones, the
// auras every cut stone carries, the shatters over the stones that fell into
// their place, the bursts over everything, and the marks on top so they are
// never lost under an effect.

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
import { type Cell, type FacetState } from "./core";
import { Presentation } from "./effects";
import { gemCenter, gemShownAt } from "./motion";
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

/**
 * Every gem on the board, each where `src/motion.ts` says it is at this
 * instant, and each the gem an offer would put in that cell.
 *
 * The drawing is clipped to the felt field, so a gem still falling in from
 * above the top row is hidden behind the bench until it crosses onto the board
 * rather than being drawn over the frame or the readouts.
 */
export function drawGems(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: FacetState,
  pourAge: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(FIELD_X, FIELD_Y, FIELD_SIZE, FIELD_SIZE);
  ctx.clip();
  for (let row = 0; row < state.board.rows; row += 1) {
    for (let col = 0; col < state.board.cols; col += 1) {
      const cell = { col, row };
      const gem = gemShownAt(state, cell);
      if (gem === null) continue;
      const [x, y] = gemCenter(state, cell, pourAge);
      drawGem(ctx, assets, gem, x, y, state.simTime);
    }
  }
  ctx.restore();
}

/** A full ring, pulsing gently on game time: the gem the player has hold of. */
function drawSelectionMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  simTime: number,
): void {
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

/** A thinner ring: the cell the held gem is currently offered into. */
function drawOfferMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.strokeStyle = COLOR.offer;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, GEM_R + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A cross on each of the two cells a refused swap named. */
function drawRefusalMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
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

/** The selection, the standing offer, and any standing refusal. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
  pourAge: number,
): void {
  const at = (cell: Cell): readonly [number, number] =>
    gemCenter(state, cell, pourAge);
  ctx.save();
  if (state.selection) {
    const [x, y] = at(state.selection);
    drawSelectionMark(ctx, x, y, state.simTime);
  }
  if (state.offer) {
    const [x, y] = at(state.offer);
    drawOfferMark(ctx, x, y);
  }
  if (state.refusal) {
    for (const cell of [state.refusal.a, state.refusal.b]) {
      const [x, y] = at(cell);
      drawRefusalMark(ctx, x, y);
    }
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
  const pourAge = presentation.pourAge();
  drawFrame(ctx, assets);
  drawGems(ctx, assets, state, pourAge);
  presentation.drawAuras(ctx, (cell) => gemCenter(state, cell, pourAge));
  presentation.drawBreaks(ctx, assets);
  presentation.drawBursts(ctx);
  drawMarks(ctx, state, pourAge);
}
