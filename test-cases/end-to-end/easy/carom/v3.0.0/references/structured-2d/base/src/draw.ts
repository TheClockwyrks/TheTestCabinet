// Carom — shared canvas arithmetic for the build's draw components.
//
// The engine owns rendering: its pipeline collects every render component,
// orders it by layer, and calls each `DrawComponent`'s `draw` with a context
// that already carries the world-to-device transform — so everything here draws
// in the logical 1280x720 space and nothing scales, translates, letterboxes, or
// looks at the canvas element. What this module holds is the vocabulary those
// components share: the neon text, the rounded glowing bars, the menus, and the
// overlay panels, each honoring the pipeline's render mode (`shaded` is the
// full picture, `wireframe` outlines alone, `unlit` and `silhouette` flat).

import type { RenderMode } from "@clockwyrks/structured-2d";
import { menuItemY, type MenuLayout } from "./menu";
import { COLOR, MONO } from "./theme";

/**
 * The canvas 2D context, with the widely supported (and, in some lib versions,
 * untyped) `letterSpacing` property available.
 */
export type Ctx = CanvasRenderingContext2D & { letterSpacing: string };

export interface TextOpts {
  size: number;
  color: string;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  spacing?: number;
  glow?: string;
  glowBlur?: number;
  alpha?: number;
}

function setFont(ctx: Ctx, o: TextOpts): void {
  ctx.font = `${o.weight ?? 400} ${o.size}px ${MONO}`;
  ctx.textAlign = o.align ?? "center";
  ctx.textBaseline = o.baseline ?? "middle";
  ctx.letterSpacing = `${o.spacing ?? 0}px`;
}

/**
 * Centered text with letter-spacing gains a trailing gap after the last glyph,
 * nudging the visual center right; compensate by half the spacing.
 */
function centerShift(o: TextOpts): number {
  return (o.align ?? "center") === "center" ? (o.spacing ?? 0) / 2 : 0;
}

export function drawText(
  ctx: Ctx,
  mode: RenderMode,
  text: string,
  x: number,
  y: number,
  o: TextOpts,
): void {
  ctx.save();
  setFont(ctx, o);
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (mode === "wireframe") {
    // Outlines alone: the text's shape, no glow and no fill.
    ctx.lineWidth = 1;
    ctx.strokeStyle = o.color;
    ctx.strokeText(text, x - centerShift(o), y);
    ctx.restore();
    return;
  }
  if (mode === "shaded" && o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowBlur ?? 20;
  }
  ctx.fillStyle = o.color;
  ctx.fillText(text, x - centerShift(o), y);
  ctx.restore();
}

export function measure(ctx: Ctx, text: string, o: TextOpts): number {
  ctx.save();
  setFont(ctx, o);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w - centerShift(o);
}

export function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * A rounded bar in a solid body color with a neon halo — the paddles, the
 * obstacles, and (as a circle elsewhere) the ball are all this one idea.
 * Wireframe strokes the outline alone; unlit and silhouette fill flat.
 */
export function glowRect(
  ctx: Ctx,
  mode: RenderMode,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  glow: string,
  blur: number,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  if (mode === "wireframe") {
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    if (mode === "shaded") {
      ctx.shadowColor = glow;
      ctx.shadowBlur = blur;
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/** The ball's glowing disc, at its own position. */
export function glowCircle(
  ctx: Ctx,
  mode: RenderMode,
  x: number,
  y: number,
  r: number,
  color: string,
  glow: string,
  blur: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (mode === "wireframe") {
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    if (mode === "shaded") {
      ctx.shadowColor = glow;
      ctx.shadowBlur = blur;
    }
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A vertical menu with a highlighted selection, drawn from the SAME layout the
 * pointer hit-tests against and `menuItemRect` reports (`src/menu.ts`). One
 * table drives all three, so what a player sees, what a finger lands on, and
 * what the reading answers cannot drift apart.
 *
 * The selected item is bright and flanked by triangle markers in the accent
 * color; the others are dim. Markers are drawn beside the measured text so they
 * never overlap it.
 */
export function drawMenu(
  ctx: Ctx,
  mode: RenderMode,
  layout: MenuLayout,
  selected: number,
  accent: string,
): void {
  for (let i = 0; i < layout.items.length; i++) {
    const y = menuItemY(layout, i);
    const isSel = i === selected;
    const opts: TextOpts = {
      size: layout.size,
      color: isSel ? COLOR.text : COLOR.textDim,
      spacing: layout.tracking,
      align: "center",
      baseline: "middle",
    };
    drawText(ctx, mode, layout.items[i], layout.centerX, y, opts);
    if (!isSel) continue;
    const w = measure(ctx, layout.items[i], opts);
    const markerOpts: TextOpts = {
      size: layout.size,
      color: accent,
      align: "center",
      baseline: "middle",
      glow: accent,
      glowBlur: 12,
    };
    const gap = 26;
    drawText(ctx, mode, "\u25b8", layout.centerX - w / 2 - gap, y, markerOpts);
    drawText(ctx, mode, "\u25c2", layout.centerX + w / 2 + gap, y, markerOpts);
  }
}

/** The raised panel the pause and match-over menus sit on. */
export function drawPanel(
  ctx: Ctx,
  mode: RenderMode,
  cx: number,
  cy: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.save();
  if (mode !== "wireframe") {
    if (mode === "shaded") {
      ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
      ctx.shadowBlur = 60;
      ctx.shadowOffsetY = 24;
    }
    ctx.fillStyle = COLOR.bgRaised;
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fill();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.restore();
  return { x, y };
}

/** A dark veil over the whole field, behind a pause or match-over panel. */
export function drawVeil(
  ctx: Ctx,
  mode: RenderMode,
  width: number,
  height: number,
  opacity: number,
): void {
  if (mode === "wireframe") return;
  ctx.save();
  ctx.fillStyle = `rgba(7, 9, 14, ${opacity})`;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
