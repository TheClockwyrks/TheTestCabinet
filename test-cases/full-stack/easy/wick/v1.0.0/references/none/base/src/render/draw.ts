// Wick — small drawing helpers shared by the world, the HUD, the screens,
// and the overlay.

import { FONT } from "./theme";

export interface TextOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  spacing?: number;
}

/** Draw `label` with its baseline at `y`. */
export function text(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  const size = options.size ?? 16;
  ctx.save();
  ctx.font = `${options.bold ? "bold " : ""}${size}px ${FONT}`;
  ctx.fillStyle = options.color ?? "#ffffff";
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (options.spacing) {
    ctx.letterSpacing = `${options.spacing}px`;
  }
  ctx.fillText(label, x, y);
  ctx.restore();
}

/** A filled circle. */
export function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke?: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** A filled rectangle given by its center. */
export function centeredRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke?: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width / 2, y - height / 2, width, height);
  }
}

/**
 * Draw `image` centered at `(x, y)` at `width x height` units, mirrored
 * across its vertical axis when `mirror` is set.
 */
export function sprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror = false,
): void {
  ctx.save();
  ctx.translate(x, y);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}
