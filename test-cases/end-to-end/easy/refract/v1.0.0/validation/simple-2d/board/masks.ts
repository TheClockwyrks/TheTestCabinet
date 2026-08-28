// Refract — board/masks: reading a node's drawn form off the rendered pixels.
//
// Private to the board category. Three review items compare what a node LOOKS
// like rather than any single color — silhouettes-distinct, crystal-distinct,
// and crystal-readout — and they share this one way of reading a region: every
// pixel within a radius of a cell center, taken in one `getImageData` over the
// canvas the engine drew into, in device pixels through the same viewport
// mapping `h.pixel` uses.
//
// A SILHOUETTE mask is that region binarized against the background sample: a
// pixel is part of the form when it differs from the background by more than
// the checklist's own apart line (50 of 441), which is deliberately
// hue-independent — a triangle and a square of two different hues binarize to
// their shapes alone, so comparing masks compares form and never palette
// (specs/board.md: "channel identity reads by form as well as by hue").
//
// Masks are compared by intersection-over-union AFTER centroid alignment, as
// the review items state: each mask is translated so its centroid sits on the
// origin before the overlap is counted, so two forms drawn slightly off their
// shared anchor are still compared shape against shape.

import { colorDistance, type Harness, type Rgb } from "../harness";

/** One pixel of a sampled disk: its offset from the center, and its color. */
export interface DiskPixel {
  dx: number;
  dy: number;
  color: Rgb;
}

/**
 * Every pixel within `radius` (logical units) of the logical point
 * `(x, y)`, read in one `getImageData`. Offsets are in device pixels; two
 * disks of the same radius sample the same offsets in the same order, so
 * their pixels compare index to index.
 */
export function diskPixels(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): DiskPixel[] {
  const view = h.engine.viewport();
  const center = h.device(x, y);
  const r = Math.ceil(radius * view.scale);
  const side = 2 * r + 1;
  const { data } = h.ctx.getImageData(center.x - r, center.y - r, side, side);
  const pixels: DiskPixel[] = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy > r * r) continue;
      const at = ((dy + r) * side + (dx + r)) * 4;
      pixels.push({
        dx,
        dy,
        color: { r: data[at], g: data[at + 1], b: data[at + 2] },
      });
    }
  }
  return pixels;
}

/** A binarized form: the on-pixel offsets, and their centroid. */
export interface Mask {
  on: readonly { dx: number; dy: number }[];
  centroidX: number;
  centroidY: number;
}

/**
 * The hue-independent mask of the form drawn within `radius` of `(x, y)`:
 * a pixel is on when it differs from `background` by more than `threshold`
 * of 441 RGB distance.
 */
export function silhouetteMask(
  h: Harness,
  x: number,
  y: number,
  radius: number,
  background: Rgb,
  threshold: number,
): Mask {
  const on = diskPixels(h, x, y, radius)
    .filter((pixel) => colorDistance(pixel.color, background) > threshold)
    .map(({ dx, dy }) => ({ dx, dy }));
  let sumX = 0;
  let sumY = 0;
  for (const pixel of on) {
    sumX += pixel.dx;
    sumY += pixel.dy;
  }
  const count = Math.max(1, on.length);
  return { on, centroidX: sumX / count, centroidY: sumY / count };
}

/**
 * Intersection-over-union of two masks after centroid alignment: `b` is
 * translated by the rounded difference of the centroids, so the two forms
 * overlap about their own centers of mass. Empty masks have no form to
 * compare; callers assert non-emptiness first.
 */
export function alignedIoU(a: Mask, b: Mask): number {
  const shiftX = Math.round(a.centroidX - b.centroidX);
  const shiftY = Math.round(a.centroidY - b.centroidY);
  const inA = new Set(a.on.map(({ dx, dy }) => `${dx},${dy}`));
  let intersection = 0;
  for (const { dx, dy } of b.on) {
    if (inA.has(`${dx + shiftX},${dy + shiftY}`)) intersection += 1;
  }
  const union = a.on.length + b.on.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * The largest pixel-to-pixel RGB distance between two equally sampled
 * regions: how far apart the two renderings get at their most different
 * point. Index-aligned, so both disks must share one radius.
 */
export function maxRegionDifference(
  a: readonly DiskPixel[],
  b: readonly DiskPixel[],
): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = colorDistance(a[i].color, b[i].color);
    if (d > max) max = d;
  }
  return max;
}
