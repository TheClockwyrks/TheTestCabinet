// Orrery — the small drawing helpers every screen shares.
//
// Nothing here knows a rule of the game: it is text, rectangles, and hexagons
// in the stage's logical units, so a caller says what to draw and not how the
// canvas wants it said.

import { FONT_STACK } from "./theme";

/** How a run of text is drawn. */
export interface TextOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  spacing?: number;
}

/** Draw one run of text at a point, in logical units. */
export function text(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  const size = options.size ?? 16;
  ctx.save();
  ctx.font = `${options.bold === true ? "600 " : ""}${size}px ${FONT_STACK}`;
  ctx.fillStyle = options.color ?? "#ffffff";
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";
  const spacing = options.spacing ?? 0;
  if (spacing === 0) {
    ctx.fillText(content, x, y);
  } else {
    // Letter spacing is not portable, so a spaced run is drawn glyph by glyph.
    const widths = [...content].map((glyph) => ctx.measureText(glyph).width);
    const total =
      widths.reduce((sum, width) => sum + width, 0) +
      spacing * Math.max(0, content.length - 1);
    let cursor =
      ctx.textAlign === "center"
        ? x - total / 2
        : ctx.textAlign === "right"
          ? x - total
          : x;
    ctx.textAlign = "left";
    [...content].forEach((glyph, index) => {
      ctx.fillText(glyph, cursor, y);
      cursor += widths[index] + spacing;
    });
  }
  ctx.restore();
}

/** Trace a rounded rectangle. The caller fills or strokes it. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Trace a pointy-top hexagon of `radius` about a center. */
export function hexPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.beginPath();
  for (let corner = 0; corner < 6; corner += 1) {
    const angle = (Math.PI / 180) * (60 * corner - 90);
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (corner === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
