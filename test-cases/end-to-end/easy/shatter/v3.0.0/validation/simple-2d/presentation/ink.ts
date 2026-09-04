// presentation — how this group reads what the build actually PAINTED.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/simple-2d/harness.ts` owns the
// compound sequences the whole project shares and the small colour vocabulary
// every group uses (`sample`, `colorDistance`); what is here is the sampling
// geometry only these seventeen checks want, so it lives beside them and leaves
// the shared file alone.
//
// NOTHING HERE FIXES A BOUND. `specs/overview.md` closes its Visual design section
// with the sentence that the palette, the type and every other aspect of the look
// are the build's, so no colour, no font and no drawn dimension is asserted
// anywhere in this group. Every check reads two things the BUILD drew and compares
// them, and the DISTANCE it demands is the check's own figure, stated and derived
// in the check. This file only says WHERE a reading is taken and how a set of
// readings is reduced to one number.
//
// ONE `getImageData` PER READING. `Harness.pixel` costs a `getImageData` for every
// point, and the checks below read tens of thousands of them, so a reading here
// copies the whole backing store once and indexes it. {@link readPainted} is that
// copy; everything else takes one.
//
// THE DISC OF SAMPLES, AND WHY IT IS POLAR. A body is posed at a centre and is
// drawn around it; a build may put its mark anywhere on it — a filled body, a bare
// outline, a canopy on one side. So the samples are laid on concentric rings,
// staggered by half a step so they do not fall into spokes, covering the whole disc
// rather than a patch of it. A ring mean is very nearly invariant under a rotation,
// which is what lets `star-halo-fades-outward` read a ramp off a build free to draw
// its halo with any texture it likes.

import { wrap, type Point } from "../geometry";
import {
  colorDistance,
  type DrawCall,
  type Harness,
  type Rgb,
} from "../harness";

/** A full turn, in radians: the discs and rings below are laid out around one. */
const TAU = Math.PI * 2;

/* -------------------------------------------------------------------------- */
/* One frame of the canvas                                                    */
/* -------------------------------------------------------------------------- */

/** The frame currently on the canvas, with what maps a logical point onto it. */
export interface Painted {
  /** The backing store's raw RGBA bytes. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** The engine's fit: where the field's origin lands and how far it is scaled. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
}

/**
 * Copy the frame the last tick left on the canvas.
 *
 * A caller advances at least one tick first: `initialize` runs the game's setup
 * and nothing else, so before the first frame the canvas is still bare.
 */
export function readPainted(h: Harness): Painted {
  const { width, height } = h.canvas;
  const { data } = h.ctx.getImageData(0, 0, width, height);
  const view = h.engine.viewport();
  return {
    data,
    width,
    height,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    scale: view.scale,
  };
}

/** The colour at a device pixel; black for anything off the surface. */
function deviceColor(p: Painted, x: number, y: number): Rgb {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) {
    return { r: 0, g: 0, b: 0 };
  }
  const at = (y * p.width + x) * 4;
  return { r: p.data[at], g: p.data[at + 1], b: p.data[at + 2] };
}

/** Where a logical point lands in the backing store. */
function toDevice(p: Painted, at: Point): { x: number; y: number } {
  return {
    x: Math.round(p.offsetX + at.x * p.scale),
    y: Math.round(p.offsetY + at.y * p.scale),
  };
}

/** The colour the build painted at a logical point, wrapped onto the field. */
export function colorAt(p: Painted, at: Point): Rgb {
  const device = toDevice(p, wrap(at));
  return deviceColor(p, device.x, device.y);
}

/** What the build painted at an arbitrary set of logical points. */
export function readPoints(p: Painted, points: readonly Point[]): Rgb[] {
  return points.map((point) => colorAt(p, point));
}

/* -------------------------------------------------------------------------- */
/* A disc of samples over a body                                              */
/* -------------------------------------------------------------------------- */

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
export function discPoints(centre: Point, radius: number): Point[] {
  const points: Point[] = [];
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

/** What the build painted over that disc, in the frame `p` holds. */
export function readDisc(p: Painted, centre: Point, radius: number): Rgb[] {
  return readPoints(p, discPoints(centre, radius));
}

/** Samples around one ring, for a reading that must not depend on an angle. */
export function ringPoints(
  centre: Point,
  radius: number,
  spokes: number,
  fromTheta = 0,
  spanTheta = TAU,
): Point[] {
  const points: Point[] = [];
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

/* -------------------------------------------------------------------------- */
/* Reducing a set of readings to one number                                   */
/* -------------------------------------------------------------------------- */

/** A colour's luminance, out of 255: the Rec. 709 weighting. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

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
  for (const reading of look) {
    if (colorDistance(reading, background) > threshold) marked += 1;
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
  for (const reading of look) {
    if (colorDistance(reading, background) <= threshold) continue;
    r += reading.r;
    g += reading.g;
    b += reading.b;
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

/** The furthest any of a set of readings falls from one colour, out of 441. */
export function furthestFrom(look: readonly Rgb[], from: Rgb): number {
  let furthest = 0;
  for (const reading of look) {
    const away = colorDistance(reading, from);
    if (away > furthest) furthest = away;
  }
  return furthest;
}

/**
 * The MEDIAN of a set of readings, ranked by luminance.
 *
 * What a check reads a local background with: a handful of samples around a mark
 * may clip a neighbouring element, and a median discards that where a mean would
 * carry it.
 */
export function medianColor(look: readonly Rgb[]): Rgb {
  const ranked = [...look].sort((a, b) => luminance(a) - luminance(b));
  return ranked[Math.floor((ranked.length - 1) / 2)];
}

/**
 * How far, on average, two readings of the SAME points moved between two frames,
 * out of 441.
 *
 * Element by element, so it measures the change at each point rather than the
 * change in the two sets' averages — a body that swapped two of its colours
 * reads as changed here and as unchanged under a difference of means.
 */
export function meanChange(
  before: readonly Rgb[],
  after: readonly Rgb[],
): number {
  const n = Math.min(before.length, after.length);
  if (n === 0) return 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += colorDistance(before[i], after[i]);
  return total / n;
}

/** The mean distance of a set of readings from one colour, out of 441. */
export function meanDistance(look: readonly Rgb[], background: Rgb): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const reading of look) total += colorDistance(reading, background);
  return total / look.length;
}

/** The mean luminance of a set of readings, out of 255. */
export function meanLuminance(look: readonly Rgb[]): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const reading of look) total += luminance(reading);
  return total / look.length;
}

/* -------------------------------------------------------------------------- */
/* A rectangle of the canvas, reduced to cells                                */
/* -------------------------------------------------------------------------- */
//
// A check that has to find WHERE a build drew something reads a whole region rather
// than a handful of points. This reduces such a region to a grid of square cells,
// each carrying the FURTHEST any pixel in it fell from a colour the caller supplies
// — so a cell holding one thin stroke reads as strongly as a cell filled solid, and
// the region carries a few tens of thousands of numbers rather than a million.

/** A rectangle of the field, in logical units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A rectangle of the canvas reduced to square cells. */
export interface InkGrid {
  /** The rectangle's top-left, in logical units. */
  readonly x: number;
  readonly y: number;
  /** One cell's side, in logical units. */
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** The furthest reading in each cell, row by row: `cols * rows` values. */
  readonly ink: number[];
}

/** Read a rectangle of the field as cells, each the furthest from `against`. */
export function readInk(
  p: Painted,
  rect: Rect,
  cell: number,
  against: Rgb,
): InkGrid {
  const step = Math.max(1, Math.round(cell * p.scale));
  const cols = Math.max(1, Math.floor((rect.w * p.scale) / step));
  const rows = Math.max(1, Math.floor((rect.h * p.scale) / step));
  const origin = toDevice(p, rect);
  const ink: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let furthest = 0;
      for (let dy = 0; dy < step; dy += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const found = deviceColor(
            p,
            origin.x + col * step + dx,
            origin.y + row * step + dy,
          );
          const away = colorDistance(found, against);
          if (away > furthest) furthest = away;
        }
      }
      ink.push(furthest);
    }
  }
  return { x: rect.x, y: rect.y, cell: step / p.scale, cols, rows, ink };
}

/** The furthest reading in one cell, out of 441. */
export function inkAt(grid: InkGrid, col: number, row: number): number {
  return grid.ink[row * grid.cols + col];
}

/** Where a cell's centre falls, in logical field units. */
export function cellCentre(grid: InkGrid, col: number, row: number): Point {
  return {
    x: grid.x + (col + 0.5) * grid.cell,
    y: grid.y + (row + 0.5) * grid.cell,
  };
}

/** One cell of a grid, by its column and row. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/** The cells of a grid whose reading is beyond `threshold` and that `keep` accepts. */
export function inkedCells(
  grid: InkGrid,
  threshold: number,
  keep: (at: Point) => boolean = () => true,
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
  keep: (at: Point) => boolean = () => true,
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
 * How many separated marks a band of cells holds, reading left to right.
 *
 * A column counts as inked when any row of the band inside it is; a run of inked
 * columns is one mark, and two marks are separated when at least `gap` bare columns
 * lie between them. What `hud-lives-are-drawn` counts glyphs with, since the glyphs
 * `specs/ui.md` puts "in a row" are separated marks by construction.
 */
export function marksInBand(
  grid: InkGrid,
  band: {
    readonly fromRow: number;
    readonly toRow: number;
    readonly fromCol: number;
    readonly toCol: number;
  },
  threshold: number,
  gap: number,
): number {
  let marks = 0;
  let bare = gap;
  for (let col = band.fromCol; col <= band.toCol; col += 1) {
    if (col < 0 || col >= grid.cols) continue;
    let inked = false;
    for (let row = band.fromRow; row <= band.toRow; row += 1) {
      if (row < 0 || row >= grid.rows) continue;
      if (inkAt(grid, col, row) > threshold) {
        inked = true;
        break;
      }
    }
    if (inked) {
      if (bare >= gap) marks += 1;
      bare = 0;
    } else {
      bare += 1;
    }
  }
  return marks;
}

/* -------------------------------------------------------------------------- */
/* The runs of text a frame drew                                              */
/* -------------------------------------------------------------------------- */
//
// `screen-text-is-legible` is the one check here that has to know WHERE a glyph is
// before it can read what is around it, and the engine's recorder answers that: a
// `fillText`/`strokeText` call is kept with the transform in force at the call, the
// width the run measured under the font then set, and the alignment that places the
// run about its anchor (`TextGeometry`, `harness.ts`). What is reconstructed here is
// the logical box those three imply, so a run is sampled across its own glyphs
// whatever size, alignment and baseline the build chose.

/** One run of text the frame drew, as a box in logical field units. */
export interface TextRun {
  /** Where the call that drew it sits in the frame's list of operations. */
  readonly at: number;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The `font` shorthand's pixel size, or `null` for one that names none. */
function fontPixels(font: unknown): number | null {
  if (typeof font !== "string") return null;
  const found = /(\d+(?:\.\d+)?)px/.exec(font);
  return found === null ? null : Number(found[1]);
}

/**
 * Where a run's box sits vertically, as a fraction of its size above the anchor.
 *
 * The canvas baselines, read off the 2D context's own definition: an alphabetic
 * baseline sits under the glyphs, a middle baseline through them, a top baseline
 * over them. The fractions are the ordinary metrics of a Latin face and are used
 * only to place a sampling box over the glyphs — nothing asserts them.
 */
function aboveAnchor(baseline: unknown): number {
  switch (baseline) {
    case "top":
    case "hanging":
      return 0.05;
    case "middle":
      return 0.5;
    default:
      return 0.8;
  }
}

/** The runs of text the recorded calls drew, oldest first. */
export function textRuns(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextRun[] {
  const view = h.engine.viewport();
  const runs: TextRun[] = [];
  let font: unknown = "10px sans-serif";
  let baseline: unknown = "alphabetic";
  for (let at = 0; at < calls.length; at += 1) {
    const call = calls[at];
    if (call.kind === "set") {
      if (call.property === "font") font = call.value;
      if (call.property === "textBaseline") baseline = call.value;
      continue;
    }
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const geometry = call.text;
    const text = call.args[0];
    const x = call.args[1];
    const y = call.args[2];
    if (
      geometry === undefined ||
      typeof text !== "string" ||
      typeof x !== "number" ||
      typeof y !== "number"
    ) {
      continue;
    }
    const m = geometry.transform;
    // The anchor through the transform in force at the call, then back out of the
    // engine's own fit, so the box is in the logical units every spec figure is in.
    const anchorX = (m.a * x + m.c * y + m.e - view.offsetX) / view.scale;
    const anchorY = (m.b * x + m.d * y + m.f - view.offsetY) / view.scale;
    const alongX = Math.hypot(m.a, m.b) / view.scale;
    const alongY = Math.hypot(m.c, m.d) / view.scale;
    const width = geometry.width * alongX;
    const size = (fontPixels(font) ?? 10) * alongY;
    const left =
      geometry.textAlign === "center"
        ? anchorX - width / 2
        : geometry.textAlign === "right" || geometry.textAlign === "end"
          ? anchorX - width
          : anchorX;
    const top = anchorY - aboveAnchor(baseline) * size;
    runs.push({
      at,
      text,
      left,
      right: left + width,
      top,
      bottom: top + size,
    });
  }
  return runs;
}

/* -------------------------------------------------------------------------- */
/* A box of text, and what is immediately around it                           */
/* -------------------------------------------------------------------------- */

/** The points of a grid `step` apart inside a rectangle. */
export function boxPoints(box: Rect, step: number): Point[] {
  const points: Point[] = [];
  const cols = Math.max(1, Math.floor(box.w / step));
  const rows = Math.max(1, Math.floor(box.h / step));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        x: box.x + ((col + 0.5) * box.w) / cols,
        y: box.y + ((row + 0.5) * box.h) / rows,
      });
    }
  }
  return points;
}

/**
 * The points of a rectangular ring `out` units outside a box, `step` apart.
 *
 * What "the pixels immediately around it" is read at: the box grown by `out` on
 * every side, sampled along its four edges, so the reading is whatever the build
 * drew right beside the mark and never the mark itself.
 */
export function aroundPoints(box: Rect, out: number, step: number): Point[] {
  const left = box.x - out;
  const right = box.x + box.w + out;
  const top = box.y - out;
  const bottom = box.y + box.h + out;
  const points: Point[] = [];
  const along = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ): void => {
    const span = Math.hypot(toX - fromX, toY - fromY);
    const n = Math.max(1, Math.round(span / step));
    for (let i = 0; i <= n; i += 1) {
      points.push({
        x: fromX + ((toX - fromX) * i) / n,
        y: fromY + ((toY - fromY) * i) / n,
      });
    }
  };
  along(left, top, right, top);
  along(left, bottom, right, bottom);
  along(left, top, left, bottom);
  along(right, top, right, bottom);
  return points;
}

/**
 * Where the last operation that painted over the WHOLE field sits in a frame's
 * list of operations, or `-1` for a frame that has none after its own clear.
 *
 * What `screen-text-is-legible` needs to know which runs a screen SHOWS.
 * `specs/ui.md` requires a screen's text to be legible "against whatever sits
 * behind it", and a build that dims the field behind a menu by filling the whole
 * of it with a translucent scrim has put something IN FRONT of everything it drew
 * earlier — the HUD it left showing under the pause menu, say. Those runs are not
 * what the rule is about, and reading them off the finished frame would measure
 * the scrim rather than the text.
 *
 * A cover is a `fillRect` or a `clearRect` whose rectangle spans the field. The
 * arguments are read as logical units, which is what an engine run's transform
 * puts them in and what every figure in this case is stated in; a build that
 * scrims with a path instead is simply not detected, and its runs are read as they
 * were before.
 */
export function lastFullCover(
  calls: readonly DrawCall[],
  width: number,
  height: number,
): number {
  let found = -1;
  for (let at = 0; at < calls.length; at += 1) {
    const call = calls[at];
    if (call.kind !== "call") continue;
    if (call.method !== "fillRect" && call.method !== "clearRect") continue;
    const [x, y, w, h] = call.args;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof w !== "number" ||
      typeof h !== "number"
    ) {
      continue;
    }
    if (x <= 0 && y <= 0 && x + w >= width && y + h >= height) found = at;
  }
  return found;
}
