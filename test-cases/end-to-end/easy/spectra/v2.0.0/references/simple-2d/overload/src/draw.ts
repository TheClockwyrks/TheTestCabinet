// Spectra — the drawing primitives the field, the HUD and the screens share.
//
// Everything here is written in the fixed 1280x720 logical space `api.ctx` arrives
// carrying, and nothing here reads the game's state: each function is handed what
// it draws. What each band's accent is, and how a seeded sprite takes its band's
// colour, live here because the field and the HUD both draw them.

import { BAND_COLOR, BAND_TINT, COLOR, font } from "./theme";
import type { Art, Band } from "./game";
import type { SpriteName } from "./assets";
import type { DeepReadonly } from "ts-essentials";

/** Text drawn at a point, with the alignment given. */
export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight: "bold" | "normal" = "bold",
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

/** The band's shape accent: a ring for cyan, a diamond for magenta. */
export function accent(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  radius: number,
  width = 2,
): void {
  ctx.strokeStyle = BAND_COLOR[band];
  ctx.lineWidth = width;
  ctx.beginPath();
  if (band === "cyan") {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  } else {
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
  }
  ctx.stroke();
}

/** A soft halo in the band's colour, drawn in code around a sprite. */
export function glow(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  radius: number,
  strength = 0.5,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, BAND_COLOR[band]);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one seeded sprite centred on `(cx, cy)`, tinted to `band`.
 *
 * The seeded bitmap is the source of both passes: the first lays the art down as it
 * is, and the second composites the band over its own alpha alone, so the shape on
 * screen is the seeded silhouette in the band's colour and nothing outside that
 * silhouette is touched. Reports whether the art was there to draw.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  art: DeepReadonly<Art>,
  name: SpriteName,
  cx: number,
  cy: number,
  w: number,
  h: number,
  band: Band | null,
  strength: number,
): boolean {
  const bitmap = art.sprites[name];
  if (bitmap === null) return false;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.drawImage(bitmap as ImageBitmap, x, y, w, h);
  if (band !== null) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.filter = BAND_TINT[band];
    ctx.drawImage(bitmap as ImageBitmap, x, y, w, h);
    ctx.filter = "none";
    ctx.restore();
  }
  return true;
}

/** The shape a missing sprite falls back to, so the band still reads. */
export function fallbackBody(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.fillStyle = BAND_COLOR[band];
  ctx.beginPath();
  ctx.moveTo(cx, cy - size / 2);
  ctx.lineTo(cx + size / 2, cy);
  ctx.lineTo(cx, cy + size / 2);
  ctx.lineTo(cx - size / 2, cy);
  ctx.closePath();
  ctx.fill();
}

/** A wash over the play field, which a menu or a banner sits on. */
export function scrim(
  ctx: CanvasRenderingContext2D,
  color: string,
  top: number,
  bottom: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, top, 1280, bottom - top);
}

/**
 * A vertical menu, its highlighted row drawn distinctly.
 *
 * Each item is drawn as its own text and nothing else, so what the screen shows is
 * the entry the specification names; the carets that mark the highlight are drawn
 * beside it rather than around it.
 */
export function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  y: number,
  step: number,
  size: number,
): void {
  items.forEach((item, i) => {
    const chosen = i === index;
    const at = y + i * step;
    label(
      ctx,
      item,
      640,
      at,
      size,
      chosen ? COLOR.accent : COLOR.textDim,
      "center",
    );
    if (!chosen) return;
    const half = ctx.measureText(item).width / 2 + size * 0.7;
    label(ctx, ">", 640 - half, at, size, COLOR.accent, "center");
    label(ctx, "<", 640 + half, at, size, COLOR.accent, "center");
  });
}
