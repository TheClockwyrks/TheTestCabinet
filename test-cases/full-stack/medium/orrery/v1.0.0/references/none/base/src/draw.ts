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

/**
 * Draw one produced sprite centered on a point, at the native canvas size its
 * row in specs/assets.md fixes, turned to `degrees`. Nothing is scaled: the
 * width and height passed are the sprite's own, in logical units.
 */
export function sprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource | null,
  x: number,
  y: number,
  width: number,
  height: number = width,
  degrees = 0,
): boolean {
  if (image === null) return false;
  ctx.save();
  ctx.translate(x, y);
  if (degrees !== 0) ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
  return true;
}

/** Draw one straight line between two points. */
export function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 1,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** Fill a rectangle, in logical units. */
export function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

/** Stroke a rectangle's outline, inset by half a unit so it stays crisp. */
export function strokeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth = 1,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.restore();
}

/** Fill a disc. */
export function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
