// Coil — the diagnostics overlay (specs/instrumentation.md).
//
// A read-only panel of whatever `src/diagnostics.ts` holds, shown and hidden with
// the backtick key and off when the game starts. It is a layer of the runtime
// rather than part of the game's presentation, so it is drawn plainly, in one
// column, clearly apart from the HUD, and it never changes anything it reports.

import { roundRect, text } from "./draw";
import type { Diagnostics } from "./diagnostics";
import { COLORS } from "./theme";

const X = 24;
const Y = 130;
const WIDTH = 340;
const PADDING = 14;
const HEADER = 24;
const LINE = 20;

/** Draw the panel over the stage, in logical units. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  diagnostics: Diagnostics,
): void {
  const lines = diagnostics.lines();
  const height = PADDING * 2 + HEADER + lines.length * LINE;

  ctx.save();
  ctx.fillStyle = "rgba(7,9,14,0.82)";
  roundRect(ctx, X, Y, WIDTH, height, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,53,80,0.9)";
  ctx.lineWidth = 1;
  roundRect(ctx, X, Y, WIDTH, height, 8);
  ctx.stroke();
  ctx.restore();

  text(ctx, "DIAGNOSTICS", X + PADDING, Y + PADDING + 12, {
    size: 12,
    color: COLORS.obstacle,
    bold: true,
    spacing: 4,
  });
  let y = Y + PADDING + HEADER + 15;
  for (const line of lines) {
    text(ctx, line.label, X + PADDING, y, {
      size: 14,
      color: COLORS.textFaint,
    });
    text(ctx, line.value, X + PADDING + 110, y, {
      size: 14,
      color: COLORS.textDim,
    });
    y += LINE;
  }
}
