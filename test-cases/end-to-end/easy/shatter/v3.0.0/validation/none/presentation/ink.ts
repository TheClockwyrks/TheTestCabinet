// presentation — how this group reads what the build actually PAINTED.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/none/harness.ts` owns the compound
// sequences the whole project shares and the small colour vocabulary every group
// uses (`sampleColor`, `sampleField`, `colorDistance`, `luminance`); what is here
// is the sampling geometry only this group's checks want, so it lives beside them
// and leaves the shared file alone.
//
// NOTHING HERE FIXES A COLOUR. `specs/overview.md` closes its Visual design
// section with the sentence that the palette, the type and every other aspect of
// the look are the build's, so no colour, no font and no drawn dimension is
// asserted anywhere in this project. What a reading here decides is whether the
// BUILD drew something where a requirement says something is drawn, always against
// the field the build itself painted. This file only says WHERE a reading is taken
// and how a set of readings is reduced to one number.
//
// THE DISC OF SAMPLES, AND WHY IT IS POLAR. A body is posed at a centre and is
// drawn around it; a build may put its mark anywhere on it — a filled body, a bare
// outline, a canopy on one side. So the samples are laid on concentric rings,
// staggered by half a step so they do not fall into spokes, covering the whole
// disc rather than a patch of it, and no reading depends on the bearing a spoke
// happened to land on — which is what lets `star-halo-fades-outward` read a build
// free to draw its halo with any texture it likes.

import { TAU } from "../constants";
import { wrap, type Vec } from "../geometry";
import { colorDistance, type Harness, type Rgb } from "../harness";

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
export function meanDistance(look: readonly Rgb[], background: Rgb): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const sample of look) total += colorDistance(sample, background);
  return total / look.length;
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

/* ---- A ring of samples ---------------------------------------------------- */

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
// reduces it there to a grid of square cells, each carrying the FURTHEST any pixel
// in it fell from a colour the caller supplies — so the crossing carries a few tens
// of thousands of numbers rather than a few million, and a cell holding one thin
// stroke reads as strongly as a cell filled solid. `Harness.page` is exposed for
// exactly this kind of check.

/** A rectangle of the field, in logical units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A rectangle of the canvas reduced to square cells.
 *
 * Each cell holds the largest RGB distance, out of 441, between any pixel inside it
 * and the reference colour the read was taken against — the field the build drew,
 * for a read that is looking for ink.
 */
export interface InkGrid {
  /** The rectangle's top-left, in logical units. */
  x: number;
  y: number;
  /** One cell's side, in logical units. */
  cell: number;
  cols: number;
  rows: number;
  /** The furthest reading in each cell, row by row: `cols * rows` values. */
  ink: number[];
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

/** Read a rectangle of the field as a grid of cells, each the furthest from `against`. */
export async function readInk(
  h: Harness,
  rect: Rect,
  cell: number,
  against: Rgb,
): Promise<InkGrid> {
  await settle(h);
  const view = h.viewport();
  const origin = h.device(rect.x, rect.y);
  const step = Math.max(1, Math.round(cell * view.scale));
  const cols = Math.max(1, Math.floor((rect.w * view.scale) / step));
  const rows = Math.max(1, Math.floor((rect.h * view.scale) / step));
  const ink = (await h.page.evaluate(
    ([left, top, side, wide, high, red, green, blue]) => {
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
      const width = Math.max(1, Math.min(wide * side, canvas.width - x0));
      const height = Math.max(1, Math.min(high * side, canvas.height - y0));
      const { data } = ctx2d.getImageData(x0, y0, width, height);
      const out: number[] = [];
      for (let row = 0; row < high; row += 1) {
        for (let col = 0; col < wide; col += 1) {
          let furthest = 0;
          for (let dy = 0; dy < side; dy += 1) {
            const y = row * side + dy;
            if (y >= height) break;
            for (let dx = 0; dx < side; dx += 1) {
              const x = col * side + dx;
              if (x >= width) break;
              const at = (y * width + x) * 4;
              const dr = data[at] - red;
              const dg = data[at + 1] - green;
              const db = data[at + 2] - blue;
              const away = Math.sqrt(dr * dr + dg * dg + db * db);
              if (away > furthest) furthest = away;
            }
          }
          out.push(furthest);
        }
      }
      return out;
    },
    [
      origin.x,
      origin.y,
      step,
      cols,
      rows,
      against.r,
      against.g,
      against.b,
    ] as const,
  )) as number[];
  return { x: rect.x, y: rect.y, cell: step / view.scale, cols, rows, ink };
}

/** The furthest reading in one cell, out of 441. */
export function inkAt(grid: InkGrid, col: number, row: number): number {
  return grid.ink[row * grid.cols + col];
}

/** Where a cell's centre falls, in logical field units. */
export function cellCentre(grid: InkGrid, col: number, row: number): Vec {
  return {
    x: grid.x + (col + 0.5) * grid.cell,
    y: grid.y + (row + 0.5) * grid.cell,
  };
}

/** One cell of a grid, by its column and row. */
export interface Cell {
  col: number;
  row: number;
}

/** The cells of a grid whose reading is beyond `threshold` and that `keep` accepts. */
export function inkedCells(
  grid: InkGrid,
  threshold: number,
  keep: (at: Vec) => boolean = () => true,
): Cell[] {
  const found: Cell[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      if (inkAt(grid, col, row) <= threshold) continue;
      if (!keep(cellCentre(grid, col, row))) continue;
      found.push({ col, row });
    }
  }
  return found;
}

/**
 * The cells of two grids of the same shape whose readings differ by more than
 * `threshold` and that `keep` accepts.
 */
export function changedCells(
  before: InkGrid,
  after: InkGrid,
  threshold: number,
  keep: (at: Vec) => boolean = () => true,
): Cell[] {
  const found: Cell[] = [];
  const cols = Math.min(before.cols, after.cols);
  const rows = Math.min(before.rows, after.rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (
        Math.abs(inkAt(after, col, row) - inkAt(before, col, row)) <= threshold
      ) {
        continue;
      }
      if (!keep(cellCentre(after, col, row))) continue;
      found.push({ col, row });
    }
  }
  return found;
}

/**
 * How many cells inside `band` carry a reading beyond `threshold`.
 *
 * The ink a band holds, in cells. What `hud-lives-are-drawn` reads a row of reserve
 * glyphs with: the ink the row carries, held against the ink ONE GLYPH THE BUILD
 * ITSELF DREW carries. Measuring the row against the build's own glyph is what lets
 * the reading sit at the sensing floor — a speck of a decorated field is a cell or
 * two where a glyph is scores of them, so the field a build paints behind its HUD
 * moves the count by a fraction of a glyph and never by one.
 */
export function inkedInBand(
  grid: InkGrid,
  band: { fromRow: number; toRow: number; fromCol: number; toCol: number },
  threshold: number,
): number {
  let cells = 0;
  for (let row = band.fromRow; row <= band.toRow; row += 1) {
    if (row < 0 || row >= grid.rows) continue;
    for (let col = band.fromCol; col <= band.toCol; col += 1) {
      if (col < 0 || col >= grid.cols) continue;
      if (inkAt(grid, col, row) > threshold) cells += 1;
    }
  }
  return cells;
}
