// Coil — the small drawing helpers the renderer and the overlay share.

import { FONT } from "./theme";

export interface TextStyle {
  size: number;
  color: string;
  align?: CanvasTextAlign;
  bold?: boolean;
  glow?: number;
  glowColor?: string;
  spacing?: number;
  alpha?: number;
}

/** Draw one run of text on an alphabetic baseline at `(x, y)`. */
export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.font = `${style.bold ? "bold " : ""}${style.size}px ${FONT}`;
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${style.spacing ?? 0}px`;
  if (style.glow) {
    ctx.shadowColor = style.glowColor ?? style.color;
    ctx.shadowBlur = style.glow;
  }
  ctx.fillStyle = style.color;
  ctx.fillText(value, x, y);
  ctx.restore();
}

/** Trace a rounded rectangle as the current path. */
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
