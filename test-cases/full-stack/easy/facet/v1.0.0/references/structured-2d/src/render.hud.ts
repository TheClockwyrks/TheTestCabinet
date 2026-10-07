// Facet — the readouts and the pause control, drawn in code (specs/assets.md
// lists the HUD, the level meter, the menus, the pointer targets, and the marks
// as the chrome the build draws itself).
//
// The board's extent is fixed by `specs/board.md` — cell centers x 388..892,
// and the produced bench around them reaching x 316..964 — so the readouts take
// the two margins the 16:9 stage leaves either side of it. The score, the level,
// and the level meter sit in the left margin; the chain multiplier, what the
// last step did, and the controls sit in the right. Nothing overlaps the board.
//
// The `PAUSE` control is drawn where `src/core/targets.ts` puts its pointer
// target and nowhere else, so what a player presses is exactly what they see,
// and that target sits in the strip to the right of the board which the board
// never reaches (specs/controls.md).
//
// `specs/ui.md` fixes the three labels (`SCORE`, `LEVEL`, `CHAIN`) and requires
// the level meter to be read "without arithmetic", so the meter is a bar with
// the two figures under it rather than a number to divide.

import {
  HUD_CHAIN_LABEL,
  HUD_LEVEL_LABEL,
  HUD_SCORE_LABEL,
  PAUSE_LABEL,
  TITLE_TEXT,
} from "./constants";
import { levelTarget, multiplierFor, targetsFor } from "./core";
import {
  COLOR,
  FONT_DISPLAY,
  FONT_NUMERIC,
  drawControl,
  drawTracked,
  font,
  roundedRect,
} from "./theme";
import type { FacetState } from "./game";

/** The left readout column: from `x` to `x + COLUMN_W`, clear of the bench. */
const LEFT_X = 44;
/** The right readout column, right-aligned on its own edge. */
const RIGHT_EDGE = 1236;
const COLUMN_W = 248;

/** A small label above a figure: dim, spaced, upper case. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
): void {
  ctx.font = font(15, 600, FONT_DISPLAY);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "center";
  const center = align === "left" ? x + COLUMN_W / 2 : x - COLUMN_W / 2;
  drawTracked(ctx, text, center, y, 3);
}

/** A big figure under a label. */
function drawFigure(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  size: number,
  color: string,
): void {
  ctx.font = font(size, 700, FONT_NUMERIC);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

/** The nameplate over the left column, so the board carries its own name. */
function drawNameplate(ctx: CanvasRenderingContext2D): void {
  ctx.font = font(38, 700, FONT_DISPLAY);
  ctx.fillStyle = COLOR.gold;
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, TITLE_TEXT, LEFT_X + COLUMN_W / 2, 104, 9);
  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(LEFT_X, 124);
  ctx.lineTo(LEFT_X + COLUMN_W, 124);
  ctx.stroke();
}

/** The level meter: `levelScore` against the level's target, as a bar. */
function drawMeter(ctx: CanvasRenderingContext2D, state: FacetState): void {
  const target = levelTarget(state.level);
  const filled = Math.min(1, Math.max(0, state.levelScore / target));
  const x = LEFT_X;
  const y = 404;
  const height = 16;

  ctx.fillStyle = COLOR.meterTrack;
  roundedRect(ctx, x, y, COLUMN_W, height, height / 2);
  ctx.fill();

  if (filled > 0) {
    ctx.fillStyle = COLOR.meterFill;
    roundedRect(
      ctx,
      x,
      y,
      Math.max(height, COLUMN_W * filled),
      height,
      height / 2,
    );
    ctx.fill();
  }

  ctx.strokeStyle = COLOR.goldDim;
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, COLUMN_W, height, height / 2);
  ctx.stroke();

  ctx.font = font(15, 500, FONT_NUMERIC);
  ctx.fillStyle = COLOR.textDim;
  ctx.textAlign = "left";
  ctx.fillText(String(state.levelScore), x, y + height + 22);
  ctx.textAlign = "right";
  ctx.fillText(String(target), x + COLUMN_W, y + height + 22);
}

/** The lines of the right column that report the chain and the last step. */
function drawChain(ctx: CanvasRenderingContext2D, state: FacetState): void {
  // `specs/ui.md`: the chain readout is shown while the phase is `resolving`
  // and absent while it is `idle`.
  if (state.phase === "resolving") {
    drawLabel(ctx, HUD_CHAIN_LABEL, RIGHT_EDGE, 190, "right");
    drawFigure(
      ctx,
      `x${multiplierFor(state.chainStep)}`,
      RIGHT_EDGE,
      248,
      "right",
      52,
      COLOR.gold,
    );
  }

  drawLabel(ctx, "LAST STEP", RIGHT_EDGE, 340, "right");
  drawFigure(
    ctx,
    `${state.lastCleared} CLEARED`,
    RIGHT_EDGE,
    374,
    "right",
    20,
    COLOR.text,
  );
  drawFigure(
    ctx,
    `+${state.lastPoints}`,
    RIGHT_EDGE,
    404,
    "right",
    20,
    COLOR.textDim,
  );
}

/**
 * The `PAUSE` control, drawn on the `pause` target `src/core/targets.ts`
 * reports for the `playing` screen.
 */
function drawPauseControl(ctx: CanvasRenderingContext2D): void {
  for (const target of targetsFor("playing")) {
    if (target.id === "pause") drawControl(ctx, target, PAUSE_LABEL);
  }
}

/** The controls, and the mute state, along the foot of the right column. */
function drawHints(ctx: CanvasRenderingContext2D, state: FacetState): void {
  const lines = [
    "PRESS A STONE TO TAKE HOLD OF IT",
    "CARRY IT ONTO ITS NEIGHBOR AND LET GO",
    "ESC or P  PAUSE     M  SOUND     `  DEBUG",
  ];
  ctx.font = font(13, 500, FONT_DISPLAY);
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR.textDim;
  lines.forEach((line, index) => {
    ctx.fillText(line, RIGHT_EDGE, 592 + index * 20);
  });
  if (state.muted) {
    ctx.fillStyle = COLOR.refusal;
    ctx.fillText("SOUND OFF", RIGHT_EDGE, 592 + lines.length * 20 + 6);
  }
}

/** Every readout on the `playing` screen, and the pause control. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: FacetState,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";

  drawNameplate(ctx);

  drawLabel(ctx, HUD_SCORE_LABEL, LEFT_X, 190, "left");
  drawFigure(ctx, String(state.score), LEFT_X, 240, "left", 46, COLOR.text);

  drawLabel(ctx, HUD_LEVEL_LABEL, LEFT_X, 306, "left");
  drawFigure(ctx, String(state.level), LEFT_X, 356, "left", 46, COLOR.text);

  drawMeter(ctx, state);
  drawChain(ctx, state);
  drawPauseControl(ctx);
  drawHints(ctx, state);

  ctx.restore();
}
