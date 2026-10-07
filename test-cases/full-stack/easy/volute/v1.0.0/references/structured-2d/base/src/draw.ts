// Volute — the two drawing primitives the chrome is built from.
//
// Everything `specs/assets.md` calls "drawn in code" — the HUD's readouts,
// gauges and frames, every screen and all of its copy, the sightline ray, and
// the danger read — is set with these.

import { COLOR, FONT } from "./theme";

/** How one line of text is set. */
export interface TextOptions {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  mono?: boolean;
  weight?: string;
  tracking?: number;
}

/** Draw one line of text. */
export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  const size = options.size ?? 14;
  const tracking = options.tracking ?? 0;
  ctx.save();
  ctx.font = `${options.weight ?? "600"} ${size}px ${
    options.mono === true ? FONT.mono : FONT.family
  }`;
  ctx.fillStyle = options.color ?? COLOR.steelLit;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";

  if (tracking !== 0) {
    // Letter-spacing is not universally available, so a tracked label is drawn
    // glyph by glyph. Only short labels are set this way.
    const glyphs = [...value];
    const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
    const total =
      widths.reduce((sum, width) => sum + width, 0) +
      tracking * (glyphs.length - 1);
    let cursor =
      ctx.textAlign === "center"
        ? x - total / 2
        : ctx.textAlign === "right"
          ? x - total
          : x;
    ctx.textAlign = "left";
    glyphs.forEach((glyph, index) => {
      ctx.fillText(glyph, cursor, y);
      cursor += widths[index] + tracking;
    });
  } else {
    ctx.fillText(value, x, y);
  }
  ctx.restore();
}

/** A filled rounded rectangle, the shape every panel in the game is cut from. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
): void {
  const radius = Math.min(10, w / 2, h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

/** One produced sprite, centered on a point, at a chosen drawn size. */
export function sprite(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  size: number,
): void {
  ctx.drawImage(
    image,
    0,
    0,
    image.width,
    image.height,
    x - size / 2,
    y - size / 2,
    size,
    size,
  );
}
