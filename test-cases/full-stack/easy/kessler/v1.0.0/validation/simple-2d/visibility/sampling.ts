// visibility — the shared sampling geometry, and the presence reading the
// visibility points decide with. CASE-PROVIDED.
//
// NOT A `.test.ts`, so vitest never collects it. The visibility category reads
// the RENDERED PIXELS, and reads exactly one thing off them: whether the build
// drew something where the specification says something is drawn. The palette,
// the contrast, and the ornament are the build's own — Kessler fixes no colors
// — and what they amount to is the reviewer's presentation rating, so no point
// in this category compares a color against a figure.
//
// HOW PRESENCE IS READ. A point is read twice, on two frames of one posed
// scene that differ only in whether the thing under test is there: the
// deflector steered to the far side, the targets cleared, the balls cleared,
// the shield lowered. A point whose color moved between those two frames is a
// point the thing was drawn on. Where the thing cannot be taken away — the
// containment circle is always drawn — the second read is the bare ground
// beside it at the same angle instead, and a point that differs from all of it
// is a point something was drawn on.
//
// THE FLOOR UNDER THAT READING is `CHANGE_MIN`: how far a sample must move
// before it counts as moved at all. It is an antialiasing and dithering
// tolerance, the same eight-of-255 the HUD's differential reading takes, and
// not a bar on how anything looks.

import type { Harness, Rgb } from "../harness";
import { polarToXy, samplePoint } from "../harness";

/**
 * How far a sample must move, on some channel of 255, before it reads as a
 * point the build drew something on. A noise floor, not a figure any
 * requirement states.
 */
export const CHANGE_MIN = 8;

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

/** Whether two reads of one point moved by more than the noise floor. */
export function moved(a: Rgb, b: Rgb): boolean {
  return (
    Math.abs(a.r - b.r) >= CHANGE_MIN ||
    Math.abs(a.g - b.g) >= CHANGE_MIN ||
    Math.abs(a.b - b.b) >= CHANGE_MIN
  );
}

/**
 * How many corresponding points of two equal reads moved: how much of the
 * sampled region the thing under test was drawn on.
 */
export function movedCount(a: readonly Rgb[], b: readonly Rgb[]): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (moved(a[i], b[i])) count += 1;
  return count;
}

/**
 * How many points of `fore` differ from EVERY point of `back`: how much of the
 * sampled region carries something the bare ground behind it does not. The
 * ground is sampled at several places, so one stray speck back there cannot
 * stand in for the whole of it.
 */
export function drawnOver(fore: readonly Rgb[], back: readonly Rgb[]): number {
  let count = 0;
  for (const f of fore) if (back.every((b) => moved(f, b))) count += 1;
  return count;
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
