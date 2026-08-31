// presentation — how this group reads what the build actually PAINTED.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares and the small colour vocabulary every group
// uses (`sampleColor`, `sampleField`, `colorDistance`, `luminance`); what is here
// is the sampling geometry only these fifteen checks want, so it lives beside
// them and leaves the shared file alone.
//
// NOTHING HERE FIXES A BOUND. `specs/overview.md` closes its Visual design
// section with the sentence that the palette, the type and every other aspect of
// the look are the build's, so no colour, no font and no drawn dimension is
// asserted anywhere in this project. Every check here reads two things the BUILD
// drew and compares them, and the DISTANCE it demands is the check's own figure,
// stated and derived in the check. This file only says WHERE a reading is taken
// and how a set of readings is reduced to one number.
//
// THE DISC OF SAMPLES, AND WHY IT IS POLAR. A body is posed at a centre and is
// drawn around it; a build may put its mark anywhere on it — a filled body, a bare
// outline, a canopy on one side. So the samples are laid on concentric rings,
// staggered by half a step so they do not fall into spokes, covering the whole
// disc rather than a patch of it. A ring mean is very nearly invariant under a
// rotation, which is what lets `star-halo-fades-outward` read a ramp off a build
// free to draw its halo with any texture it likes.

import { TAU } from "../constants";
import { wrap, type Vec } from "../geometry";
import {
  colorDistance,
  luminance,
  type Harness,
  type Rgb,
} from "../harness";

/* ---- A disc of samples over a body --------------------------------------- */

/** Concentric rings of samples, from the centre outward. */
export const DISC_RINGS = 21;

/** Samples around each ring. */
export const DISC_SPOKES = 21;

/** How many readings one disc is: `DISC_RINGS * DISC_SPOKES`. */
export const DISC_SAMPLES = DISC_RINGS * DISC_SPOKES;

/**
 * The points a disc of `radius` about `centre` is read at, wrapped onto the field.
 *
 * The outermost ring sits at `(DISC_RINGS - 0.5) / DISC_RINGS` of the radius, so
 * every point is strictly inside the circle the caller named and no reading is
 * taken on the edge, where a build's own anti-aliasing lives.
 */
export function discPoints(centre: Vec, radius: number): Vec[] {
  const points: Vec[] = [];
  for (let ring = 0; ring < DISC_RINGS; ring += 1) {
    const at = (radius * (ring + 0.5)) / DISC_RINGS;
    for (let spoke = 0; spoke < DISC_SPOKES; spoke += 1) {
      const theta = (TAU * (spoke + 0.5 * ring)) / DISC_SPOKES;
      points.push(
        wrap({
          x: centre.x + at * Math.cos(theta),
          y: centre.y + at * Math.sin(theta),
        }),
      );
    }
  }
  return points;
}

/** What the build has painted over that disc as the canvas stands now. */
export async function readDisc(
  h: Harness,
  centre: Vec,
  radius: number,
): Promise<Rgb[]> {
  return readPoints(h, discPoints(centre, radius));
}

/** What the build has painted at an arbitrary set of logical points. */
export async function readPoints(
  h: Harness,
  points: readonly Vec[],
): Promise<Rgb[]> {
  const read = await h.pixels(points.map((point) => wrap(point)));
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/* ---- Reducing a set of readings to one number ---------------------------- */

/**
 * How many of the samples are MARKED: further from `background` than `threshold`.
 *
 * The reading every "is this drawn at all" check rests on. A build that drew
 * nothing over the point scores zero however dark or bright its field is, because
 * the comparison is against the field the build itself chose.
 */
export function markedCount(
  look: readonly Rgb[],
  background: Rgb,
  threshold: number,
): number {
  let marked = 0;
  for (const sample of look) {
    if (colorDistance(sample, background) > threshold) marked += 1;
  }
  return marked;
}

/**
 * The mean colour of the marked samples: what the build drew this body IN, as
 * opposed to what it left the field behind it.
 *
 * `null` when nothing was marked, which the caller reports as the body not having
 * been drawn rather than as a colour comparison it could not make.
 */
export function markedColor(
  look: readonly Rgb[],
  background: Rgb,
  threshold: number,
): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let marked = 0;
  for (const sample of look) {
    if (colorDistance(sample, background) <= threshold) continue;
    r += sample.r;
    g += sample.g;
    b += sample.b;
    marked += 1;
  }
  if (marked === 0) return null;
  return { r: r / marked, g: g / marked, b: b / marked };
}

/** How many samples moved by more than `threshold` between two readings. */
export function changedSamples(
  before: readonly Rgb[],
  after: readonly Rgb[],
  threshold: number,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined) continue;
    if (colorDistance(a, b) > threshold) changed += 1;
  }
  return changed;
}

/** The mean distance of a set of readings from one colour, out of 441. */
export function meanDistance(
  look: readonly Rgb[],
  background: Rgb,
): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const sample of look) total += colorDistance(sample, background);
  return total / look.length;
}

/** The mean luminance of a set of readings, out of 255. */
export function meanLuminance(look: readonly Rgb[]): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const sample of look) total += luminance(sample);
  return total / look.length;
}

/** The middle value of a list of numbers; the low middle when there are two. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** The value `fraction` of the way up a sorted list, by linear position. */
export function percentile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(fraction * (sorted.length - 1))),
  );
  return sorted[at];
}

/* ---- A ring of samples, for a ramp --------------------------------------- */

/** Samples around one ring, for a reading that must not depend on an angle. */
export function ringPoints(
  centre: Vec,
  radius: number,
  spokes: number,
  fromTheta = 0,
  spanTheta = TAU,
): Vec[] {
  const points: Vec[] = [];
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    const theta = fromTheta + (spanTheta * (spoke + 0.5)) / spokes;
    points.push(
      wrap({
        x: centre.x + radius * Math.cos(theta),
        y: centre.y + radius * Math.sin(theta),
      }),
    );
  }
  return points;
}

/* ---- A rectangle of the canvas, in one crossing -------------------------- */
//
// A check that has to find WHERE a build drew something reads tens of thousands of
// pixels rather than a handful, and `Harness.pixels` costs one `getImageData` per
// point. This takes ONE `getImageData` over the whole rectangle inside the page and
// reduces it to a grid of cell means there, so the crossing carries a few thousand
// numbers instead of a few million. `Harness.page` is exposed for exactly this.

/** A rectangle of the field, in logical units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle of the canvas reduced to square cells, each the mean of its pixels. */
export interface CellGrid {
  /** The rectangle's top-left, in logical units. */
  x: number;
  y: number;
  /** One cell's side, in logical units. */
  cell: number;
  cols: number;
  rows: number;
  /** `r, g, b` for each cell, row by row: `3 * cols * rows` values. */
  rgb: number[];
}

/** One animation frame, so a read sees the picture the last tick left behind. */
async function settle(h: Harness): Promise<void> {
  await h.page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => done());
      }),
  );
}

/** Read a rectangle of the field as a grid of `cell`-sized means. */
export async function readCells(
  h: Harness,
  rect: Rect,
  cell: number,
): Promise<CellGrid> {
  await settle(h);
  const view = h.viewport();
  const origin = h.device(rect.x, rect.y);
  const step = Math.max(1, Math.round(cell * view.scale));
  const cols = Math.max(1, Math.floor((rect.w * view.scale) / step));
  const rows = Math.max(1, Math.floor((rect.h * view.scale) / step));
  const rgb = (await h.page.evaluate(
    ([left, top, side, wide, high]) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0) {
        throw new Error("shatter: the page has no <canvas>");
      }
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height) {
          canvas = other;
        }
      }
      const ctx2d = canvas.getContext("2d");
      if (ctx2d === null) {
        throw new Error("shatter: the canvas has no 2D context");
      }
      const x0 = Math.min(Math.max(left, 0), Math.max(canvas.width - 1, 0));
      const y0 = Math.min(Math.max(top, 0), Math.max(canvas.height - 1, 0));
      const width = Math.min(wide * side, canvas.width - x0);
      const height = Math.min(high * side, canvas.height - y0);
      const { data } = ctx2d.getImageData(x0, y0, width, height);
      const out: number[] = [];
      for (let row = 0; row < high; row += 1) {
        for (let col = 0; col < wide; col += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let seen = 0;
          for (let dy = 0; dy < side; dy += 1) {
            const y = row * side + dy;
            if (y >= height) break;
            for (let dx = 0; dx < side; dx += 1) {
              const x = col * side + dx;
              if (x >= width) break;
              const at = (y * width + x) * 4;
              r += data[at];
              g += data[at + 1];
              b += data[at + 2];
              seen += 1;
            }
          }
          const by = Math.max(1, seen);
          out.push(r / by, g / by, b / by);
        }
      }
      return out;
    },
    [origin.x, origin.y, step, cols, rows] as const,
  )) as number[];
  return { x: rect.x, y: rect.y, cell: step / view.scale, cols, rows, rgb };
}

/** One cell's mean colour. */
export function cellColor(grid: CellGrid, col: number, row: number): Rgb {
  const at = (row * grid.cols + col) * 3;
  return { r: grid.rgb[at], g: grid.rgb[at + 1], b: grid.rgb[at + 2] };
}

/** Where a cell's centre falls, in logical field units. */
export function cellCentre(grid: CellGrid, col: number, row: number): Vec {
  return {
    x: grid.x + (col + 0.5) * grid.cell,
    y: grid.y + (row + 0.5) * grid.cell,
  };
}

/**
 * The cells of two grids of the same shape that differ by more than `threshold`,
 * as `[col, row]` pairs, keeping only those a caller's filter accepts.
 */
export function differingCells(
  before: CellGrid,
  after: CellGrid,
  threshold: number,
  keep: (at: Vec) => boolean = () => true,
): { col: number; row: number }[] {
  const found: { col: number; row: number }[] = [];
  const cols = Math.min(before.cols, after.cols);
  const rows = Math.min(before.rows, after.rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (
        colorDistance(cellColor(before, col, row), cellColor(after, col, row)) <=
        threshold
      ) {
        continue;
      }
      if (!keep(cellCentre(after, col, row))) continue;
      found.push({ col, row });
    }
  }
  return found;
}
