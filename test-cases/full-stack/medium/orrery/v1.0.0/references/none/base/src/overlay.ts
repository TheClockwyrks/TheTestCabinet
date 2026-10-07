// Orrery — the debug overlay (specs/instrumentation.md "Diagnostics").
//
// A read-only panel of whatever `src/diagnostics.ts` holds, shown and hidden
// with the backtick key and OFF when the game starts. It is a layer of the
// runtime rather than part of the game's presentation, so it is drawn plainly,
// in one column, clearly apart from the editor's own panels, and it never
// changes anything it reports.

import type { Diagnostics } from "./diagnostics";
import { roundRect, text } from "./draw";
import { COLORS } from "./theme";

const X = 240;
const Y = 60;
const WIDTH = 300;
const PADDING = 12;
const HEADER = 22;
const LINE = 18;

/** Draw the panel over the stage, in logical units. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  diagnostics: Diagnostics,
): void {
  const lines = diagnostics.lines();
  const height = PADDING * 2 + HEADER + lines.length * LINE;

  ctx.save();
  ctx.fillStyle = "rgba(4, 6, 12, 0.86)";
  roundRect(ctx, X, Y, WIDTH, height, 6);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1;
  roundRect(ctx, X, Y, WIDTH, height, 6);
  ctx.stroke();
  ctx.restore();

  text(ctx, "DIAGNOSTICS", X + PADDING, Y + PADDING + 11, {
    size: 11,
    color: COLORS.brass,
    bold: true,
    spacing: 3,
  });
  let y = Y + PADDING + HEADER + 12;
  for (const line of lines) {
    text(ctx, line.label, X + PADDING, y, {
      size: 12,
      color: COLORS.textFaint,
    });
    text(ctx, line.value, X + PADDING + 110, y, {
      size: 12,
      color: COLORS.textDim,
    });
    y += LINE;
  }
}
