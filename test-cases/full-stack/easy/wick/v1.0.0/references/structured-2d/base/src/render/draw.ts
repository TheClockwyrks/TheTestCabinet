// Wick — small drawing helpers shared by the world, the HUD, the screens,
// and the overlay.

import { STAGE_H, STAGE_W } from "../constants";
import { COLORS, FONT } from "./theme";

/** Quiet the world beneath a menu or an overlay. */
export function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLORS.dim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

export interface TextOptions {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  spacing?: number;
  /** Whether a dark shadow sits under the text; on unless set off. */
  shadow?: boolean;
}

const SHADOW = "rgba(0, 0, 0, 0.75)";

/** Draw `label` with its baseline at `y`, over a shadow that keeps it legible. */
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
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (options.spacing) {
    ctx.letterSpacing = `${options.spacing}px`;
  }
  if (options.shadow !== false) {
    const offset = size >= 40 ? 3 : size >= 24 ? 2 : 1;
    ctx.fillStyle = SHADOW;
    ctx.fillText(label, x + offset, y + offset);
  }
  ctx.fillStyle = options.color ?? "#ffffff";
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

export interface SpriteOptions {
  /** Mirror across the sprite's vertical axis. */
  mirror?: boolean;
  /** Turn clockwise by this many radians about the center. */
  rotation?: number;
  /** Opacity, `1` unless given. */
  alpha?: number;
}

/**
 * Draw `image` centered at `(x, y)` at `width x height` units, mirrored,
 * rotated, or faded as `options` say.
 */
export function sprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  options: SpriteOptions = {},
): void {
  ctx.save();
  ctx.translate(x, y);
  if (options.rotation) ctx.rotate(options.rotation);
  if (options.mirror) ctx.scale(-1, 1);
  if (options.alpha !== undefined) ctx.globalAlpha = options.alpha;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}
