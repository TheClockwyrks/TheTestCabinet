// board/sampling — the pixel-region readings this category's suites share.
// PRIVATE to `board/`: the shared harness owns the single-point cluster
// (`sampleColor`) and the bench (`sampleBench`); what lives here is the
// region-sized readings only these suites take — a disk of samples around a
// cell center, the hue-independent mask it binarizes to, the centroid-aligned
// intersection-over-union two masks are compared by, and the paired
// point-by-point distance two regions of the same shape are compared by.
//
// Every figure is one the review items state: `DISTINCT_MIN` (50 of 441) is the
// case's line for a reading "clearly apart" from another, and `MATCH_MAX`
// (25 of 441) its line for a reading that "matches". The masks binarize on
// `DISTINCT_MIN` — a pixel is part of a node's form when it stands apart from
// the bench the way the items require the form as a whole to — which is what
// makes the mask hue-independent: a triangle and a square of two different
// hues binarize to their shapes alone, and the comparison reads form.

import type { Harness, Rgb } from "../harness";
import { colorDistance } from "../harness";
import { NODE_R } from "../notation";

/** The case's "clearly apart" line: more than 50 of the 441 the RGB cube spans. */
export const DISTINCT_MIN = 50;

/** The case's "matches" line: within 25 of 441. */
export const MATCH_MAX = 25;

/** How far apart, in logical px, the disk's sample points sit on each axis. */
export const SAMPLE_STRIDE = 2;

/** A disk of samples around a point: each offset from the center, and its color. */
export interface DiskSample {
  /** Sample offsets from the disk's center, in logical px, in a fixed order. */
  offsets: readonly { dx: number; dy: number }[];
  /** The rendered color under each offset, in the same order. */
  colors: readonly Rgb[];
}

/**
 * Sample the rendered pixels within `radius` of a logical point, on a
 * `SAMPLE_STRIDE` grid, in one crossing into the page.
 *
 * The default radius is `NODE_R`: the box a node's whole drawn form must fit
 * inside (`specs/board.md`), so a disk at a cell center reads the node and
 * nothing of its neighbours, which sit a full `CELL_PITCH` away.
 */
export async function sampleDisk(
  h: Harness,
  x: number,
  y: number,
  radius: number = NODE_R,
): Promise<DiskSample> {
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -radius; dy <= radius; dy += SAMPLE_STRIDE) {
    for (let dx = -radius; dx <= radius; dx += SAMPLE_STRIDE) {
      if (dx * dx + dy * dy <= radius * radius) offsets.push({ dx, dy });
    }
  }
  const read = await h.pixels(
    offsets.map(({ dx, dy }) => ({ x: x + dx, y: y + dy })),
  );
  const colors = read.map(([r, g, b]) => ({ r, g, b }));
  return { offsets, colors };
}

/** A binarized region: which sample offsets stood apart from the background. */
export interface Mask {
  /** The offsets in the mask, keyed `dx,dy`, in logical px. */
  points: Set<string>;
  /** How many offsets are in the mask. */
  size: number;
  /** The mask's centroid, as mean offsets from the disk's center. */
  centroid: { x: number; y: number };
}

/**
 * Binarize a disk against the background: the hue-independent mask of the form
 * drawn there. A sample is in when it sits more than `DISTINCT_MIN` from the
 * background — apart from the bench the way the items read "apart" everywhere.
 */
export function maskOf(disk: DiskSample, background: Rgb): Mask {
  const points = new Set<string>();
  let sumX = 0;
  let sumY = 0;
  for (const [index, offset] of disk.offsets.entries()) {
    const color = disk.colors[index];
    if (colorDistance(color, background) > DISTINCT_MIN) {
      points.add(`${offset.dx},${offset.dy}`);
      sumX += offset.dx;
      sumY += offset.dy;
    }
  }
  const size = points.size;
  return {
    points,
    size,
    centroid: size === 0 ? { x: 0, y: 0 } : { x: sumX / size, y: sumY / size },
  };
}

/**
 * The intersection-over-union of two masks after centroid alignment: `b` is
 * shifted so the two centroids coincide (to the nearest sample stride, the
 * finest the grid can express), then IoU is read over the shared grid.
 *
 * Alignment first, because the comparison is of FORM: two identical shapes
 * drawn a few pixels apart within their cells are the same silhouette, and
 * only the aligned overlap says whether the shapes themselves differ.
 */
export function iouAligned(a: Mask, b: Mask): number {
  if (a.size === 0 || b.size === 0) return 0;
  const shiftX =
    Math.round((a.centroid.x - b.centroid.x) / SAMPLE_STRIDE) * SAMPLE_STRIDE;
  const shiftY =
    Math.round((a.centroid.y - b.centroid.y) / SAMPLE_STRIDE) * SAMPLE_STRIDE;
  const shifted = new Set<string>();
  for (const key of b.points) {
    const [dx, dy] = key.split(",").map(Number);
    shifted.add(`${dx + shiftX},${dy + shiftY}`);
  }
  let intersection = 0;
  for (const key of shifted) {
    if (a.points.has(key)) intersection += 1;
  }
  const union = a.size + shifted.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Radii a node's form is swept over, all inside `NODE_R`. */
const SWEEP_RADII = [6, 10, 14, 18, 22, 26, 30] as const;

/** Directions per swept radius: every 22.5 degrees, so a thin ring cannot slip by. */
const SWEEP_ANGLES = 16;

/**
 * The farthest any pixel within `NODE_R` of a point sits from `reference`,
 * over a sweep of radii and directions.
 *
 * The reading for a form that need not be filled at its center: an emitter is
 * OUTLINED and open there (`specs/board.md`), so what proves it drawn at its
 * cell center is that somewhere inside its permitted radius its stroke stands
 * apart from the ground.
 */
export async function sweepMaxDistance(
  h: Harness,
  at: { x: number; y: number },
  reference: Rgb,
): Promise<number> {
  const points: { x: number; y: number }[] = [];
  for (const radius of SWEEP_RADII) {
    for (let step = 0; step < SWEEP_ANGLES; step += 1) {
      const angle = (step / SWEEP_ANGLES) * 2 * Math.PI;
      points.push({
        x: at.x + radius * Math.cos(angle),
        y: at.y + radius * Math.sin(angle),
      });
    }
  }
  const read = await h.pixels(points);
  let max = 0;
  for (const [r, g, b] of read) {
    const distance = colorDistance({ r, g, b }, reference);
    if (distance > max) max = distance;
  }
  return max;
}

/**
 * The largest point-by-point color distance between two disks of the same
 * shape: how far apart the two regions get anywhere, offset against offset.
 *
 * The paired reading rather than a mean, because two regions that differ in a
 * detail — a charge pip present on one and absent from the other — differ
 * loudly at that detail and hardly at all on average, and the detail is
 * exactly what "reads without counting" requires to be there.
 */
export function maxPairedDistance(a: DiskSample, b: DiskSample): number {
  let max = 0;
  const count = Math.min(a.colors.length, b.colors.length);
  for (let index = 0; index < count; index += 1) {
    const distance = colorDistance(a.colors[index], b.colors[index]);
    if (distance > max) max = distance;
  }
  return max;
}
