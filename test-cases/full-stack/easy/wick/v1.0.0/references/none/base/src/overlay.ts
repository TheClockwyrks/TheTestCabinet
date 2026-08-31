// Wick — the debug overlay (specs/instrumentation.md "Diagnostics").
//
// A read-only panel of whatever `src/diagnostics.ts` holds, shown and hidden
// with the backtick key and off when the game starts. It is a layer of the
// runtime rather than part of the game's presentation, so it is drawn
// plainly, in one column, clearly apart from the HUD.

import type { Diagnostics } from "./diagnostics";
import { text } from "./render/draw";

const X = 24;
const Y = 120;
const WIDTH = 460;
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
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillRect(X, Y, WIDTH, height);
  ctx.strokeStyle = "#8a8a8a";
  ctx.lineWidth = 1;
  ctx.strokeRect(X + 0.5, Y + 0.5, WIDTH - 1, height - 1);
  ctx.restore();

  text(ctx, "DIAGNOSTICS", X + PADDING, Y + PADDING + 11, {
    size: 12,
    color: "#dddddd",
    bold: true,
  });
  let y = Y + PADDING + HEADER + 12;
  for (const line of lines) {
    text(ctx, line.label, X + PADDING, y, { size: 12, color: "#9a9a9a" });
    text(ctx, line.value, X + PADDING + 110, y, { size: 12, color: "#e6e6e6" });
    y += LINE;
  }
}
