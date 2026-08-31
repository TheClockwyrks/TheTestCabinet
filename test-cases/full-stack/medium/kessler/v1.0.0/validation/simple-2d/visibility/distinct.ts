// visibility — the shared reading half of the visibility points. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. The visibility category reads
// the RENDERED PIXELS: whether the deflector, the ball, a target, a pod, the
// containment circle, the shield ring, and each run of screen text stand apart
// from whatever the build painted behind them. The palette is the build's own —
// Kessler fixes no colors — so every point here compares places on one frame
// (or the same place on two frames) rather than asserting any color.
//
// THE FIGURE. The specification words these requirements — "stands apart",
// "told apart", "visibly distinct", "legible against", "reads at a glance" —
// and fixes no number for them, so this file fixes the one honest tolerance the
// whole category is read at: two colors are CLEARLY APART when they sit more
// than `DISTINCT_MIN` (50) apart of the ~441 the RGB cube spans. That is the
// same convention Coil's visibility category states in its review items: about
// a ninth of the cube's diagonal, far below any pair a player tells apart at a
// glance, and far above antialiasing drift or a starfield's noise.

import type { Harness, Rgb } from "../harness";
import { colorDistance, polarToXy, samplePoint } from "../harness";

/**
 * More than this, of the ~441 the RGB cube spans, is clearly apart. See the
 * file comment: the category's one figure for every "stands apart" read.
 */
export const DISTINCT_MIN = 50;

/**
 * How many of the twenty sampled angle columns may stand apart from the local
 * field before an ABSENCE point reads a drawn ring: four. A shield ring drawn
 * while none is active separates essentially every column; a star or two of
 * the build's own starfield happening to sit inside the sampled band separates
 * an isolated column. Four of twenty tolerates stray specks and still fails
 * any coherent arc a player could read protection off.
 */
export const ABSENCE_MAX_COLUMNS = 4;

/** A logical point on the stage. */
export interface Pt {
  x: number;
  y: number;
}

/** A polar sample: radius and stage angle, `specs/overview.md`'s mapping. */
export interface Polar {
  r: number;
  theta: number;
}

/** The polar samples as stage points, clamped onto the canvas. */
export function polarPoints(samples: readonly Polar[]): Pt[] {
  return samples.map(({ r, theta }) => clampPt(polarToXy(r, theta)));
}

/** Every `{r, theta}` pair of two axes, radii outermost. */
export function polarGrid(
  radii: readonly number[],
  thetas: readonly number[],
): Polar[] {
  const grid: Polar[] = [];
  for (const r of radii) for (const theta of thetas) grid.push({ r, theta });
  return grid;
}

/** A square grid of points about `center`, one per offset pair. */
export function gridAround(center: Pt, offsets: readonly number[]): Pt[] {
  const grid: Pt[] = [];
  for (const dy of offsets)
    for (const dx of offsets)
      grid.push(clampPt({ x: center.x + dx, y: center.y + dy }));
  return grid;
}

/** Keep a sample point on the canvas, so an edge patch still reads. */
export function clampPt(point: Pt): Pt {
  return {
    x: Math.min(998, Math.max(1, Math.round(point.x))),
    y: Math.min(998, Math.max(1, Math.round(point.y))),
  };
}

/** The colors rendered at several logical points. */
export function samplePoints(h: Harness, points: readonly Pt[]): Rgb[] {
  return points.map((point) => samplePoint(h, point.x, point.y));
}

/**
 * How far the foreground stands from the background: the best-separated
 * foreground sample, each held to its NEAREST background sample. The thing
 * under test must show at least one place clearly apart from every sampled
 * shade of what lies behind it; the background is sampled at several places so
 * one stray bright speck back there cannot stand in for the whole field.
 */
export function separation(fore: readonly Rgb[], back: readonly Rgb[]): number {
  let best = 0;
  for (const f of fore) {
    let nearest = Infinity;
    for (const b of back) nearest = Math.min(nearest, colorDistance(f, b));
    best = Math.max(best, nearest);
  }
  return best;
}

/** The widest distance between two colors of one set: the patch's contrast. */
export function contrast(colors: readonly Rgb[]): number {
  let widest = 0;
  for (let a = 0; a < colors.length; a += 1)
    for (let b = a + 1; b < colors.length; b += 1)
      widest = Math.max(widest, colorDistance(colors[a], colors[b]));
  return widest;
}

/** The widest distance between corresponding entries of two equal reads. */
export function maxCorresponding(a: readonly Rgb[], b: readonly Rgb[]): number {
  let widest = 0;
  for (let i = 0; i < a.length; i += 1)
    widest = Math.max(widest, colorDistance(a[i], b[i]));
  return widest;
}

/**
 * The median distance between corresponding entries of two equal reads: how
 * far two renderings of the SAME thing sit apart, read so that an antialiased
 * edge landing on one or two sample points cannot decide it.
 */
export function medianCorresponding(
  a: readonly Rgb[],
  b: readonly Rgb[],
): number {
  const distances = a
    .map((color, i) => colorDistance(color, b[i]))
    .sort((x, y) => x - y);
  return distances[Math.floor(distances.length / 2)];
}

/** The five offsets sampling inside a ball's 8-unit disc: center and sides. */
export const BALL_POINTS: readonly Pt[] = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: -3, y: 0 },
  { x: 0, y: 3 },
  { x: 0, y: -3 },
];

/** The ball-disc sample points about `center`. */
export function ballGrid(center: Pt): Pt[] {
  return BALL_POINTS.map((o) =>
    clampPt({ x: center.x + o.x, y: center.y + o.y }),
  );
}

/** The offsets sampling a pod's 24-pixel canvas: a 5 x 5 grid. */
export const POD_OFFSETS: readonly number[] = [-8, -4, 0, 4, 8];

/**
 * The patch a run of screen text is read from: a grid about the run's anchor,
 * wide enough to catch glyphs whichever way the build aligned the run, dense
 * enough (3-unit steps) that the thinnest stem a legible glyph carries still
 * lands on sample points, and tall enough to cover any baseline convention.
 */
export function patchAround(anchor: Pt): Pt[] {
  const points: Pt[] = [];
  for (let dy = -30; dy <= 30; dy += 3)
    for (let dx = -40; dx <= 40; dx += 3)
      points.push(clampPt({ x: anchor.x + dx, y: anchor.y + dy }));
  return points;
}
