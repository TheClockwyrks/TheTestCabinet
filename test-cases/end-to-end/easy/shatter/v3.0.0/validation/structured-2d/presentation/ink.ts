// presentation — how this group reads what the build actually PAINTED.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/structured-2d/harness.ts` owns the
// compound sequences the whole project shares and the small colour vocabulary
// every group uses (`sampleColor`, `colorDistance`, `litAround`); what is here is
// the sampling geometry only this group's checks want, so it lives beside them and
// leaves the shared file alone.
//
// NOTHING HERE FIXES A COLOUR. `specs/overview.md` closes its Visual design section
// with the sentence that the palette, the type and every other aspect of the look
// are the build's, so no colour, no font and no drawn dimension is asserted
// anywhere in this group. What a reading here decides is whether the BUILD drew
// something where a requirement says something is drawn, always against the field
// the build itself painted. This file only says WHERE a reading is taken and how a
// set of readings is reduced to one number.
//
// ONE `getImageData` PER READING. `Harness.pixel` costs a `getImageData` for every
// point, and the checks below read tens of thousands of them, so a reading here
// copies the whole backing store once and indexes it. {@link readPainted} is that
// copy; everything else takes one.
//
// AND THE MAPPING IS THE HARNESS'S OWN. A logical field point reaches a device
// pixel through `Harness.device`, which projects through the open world's camera
// and then through the engine's fit, so a reading stays honest against a build
// that moved its camera. `Painted` carries that function and the scale measured
// through it rather than re-deriving either.
//
// THE DISC OF SAMPLES, AND WHY IT IS POLAR. A body is posed at a centre and is
// drawn around it; a build may put its mark anywhere on it — a filled body, a bare
// outline, a canopy on one side. So the samples are laid on concentric rings,
// staggered by half a step so they do not fall into spokes, covering the whole disc
// rather than a patch of it, and no reading depends on the bearing a spoke happened
// to land on — which is what lets `star-halo-fades-outward` read a build free to
// draw its halo with any texture it likes.

import { FIELD_W } from "../constants";
import { wrapPoint, type Vec } from "../geometry";
import {
  colorDistance,
  spelledTextRuns,
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
  /** Where a logical field point lands in the backing store. */
  readonly device: (x: number, y: number) => { x: number; y: number };
  /** Device pixels per logical unit, measured through that same mapping. */
  readonly scale: number;
}

/**
 * Copy the frame the last frame left on the canvas.
 *
 * A caller advances at least one frame first: `engine.initialize()` runs the
 * game's setup and nothing else, so before the first frame the canvas is bare.
 *
 * The scale is measured across the whole field rather than taken from the
 * viewport, so it is the scale of the SAME mapping every sample here is placed
 * through, camera and fit together.
 */
export function readPainted(h: Harness): Painted {
  const { width, height } = h.canvas;
  const { data } = h.ctx.getImageData(0, 0, width, height);
  const origin = h.device(0, 0);
  const across = h.device(FIELD_W, 0);
  return {
    data,
    width,
    height,
    device: (x, y) => h.device(x, y),
    scale: (across.x - origin.x) / FIELD_W,
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

/** The colour the build painted at a logical point, wrapped onto the field. */
export function colorAt(p: Painted, at: Vec): Rgb {
  const onField = wrapPoint(at);
  const device = p.device(onField.x, onField.y);
  return deviceColor(p, device.x, device.y);
}

/** What the build painted at an arbitrary set of logical points. */
export function readPoints(p: Painted, points: readonly Vec[]): Rgb[] {
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
export function discPoints(centre: Vec, radius: number): Vec[] {
  const points: Vec[] = [];
  for (let ring = 0; ring < DISC_RINGS; ring += 1) {
    const at = (radius * (ring + 0.5)) / DISC_RINGS;
    for (let spoke = 0; spoke < DISC_SPOKES; spoke += 1) {
      const theta = (TAU * (spoke + 0.5 * ring)) / DISC_SPOKES;
      points.push(
        wrapPoint({
          x: centre.x + at * Math.cos(theta),
          y: centre.y + at * Math.sin(theta),
        }),
      );
    }
  }
  return points;
}

/** What the build painted over that disc, in the frame `p` holds. */
export function readDisc(p: Painted, centre: Vec, radius: number): Rgb[] {
  return readPoints(p, discPoints(centre, radius));
}

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
      wrapPoint({
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

/** How many samples moved by more than `threshold` between two readings. */
export function changedSamples(
  before: readonly Rgb[],
  after: readonly Rgb[],
  threshold: number,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (colorDistance(before[i], after[i]) > threshold) changed += 1;
  }
  return changed;
}

/** The mean distance of a set of readings from one colour, out of 441. */
export function meanDistance(look: readonly Rgb[], background: Rgb): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const reading of look) total += colorDistance(reading, background);
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
  const origin = p.device(rect.x, rect.y);
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
export function cellCentre(grid: InkGrid, col: number, row: number): Vec {
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
  band: {
    readonly fromRow: number;
    readonly toRow: number;
    readonly fromCol: number;
    readonly toCol: number;
  },
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

/* -------------------------------------------------------------------------- */
/* The runs of text a frame drew                                              */
/* -------------------------------------------------------------------------- */
//
// Two checks here have to know WHERE a run of text is — `hud-score-is-drawn` and
// `wave-banner-is-drawn`, each of which reads whereabouts on the field its own run
// landed — and the harness's recorder answers that: a `fillText`/`strokeText` call
// is kept with the transform in force at the call, the width the run measured under
// the font then set, and the alignment that places the run about its anchor
// (`TextGeometry`, the shared harness's `draw-calls`). What is reconstructed here
// is the logical box those three imply, whatever size, alignment and baseline the
// build chose.
//
// The anchor comes back out through the engine's fit alone, which is how
// `Harness.drawnTextSpans` places a run: the pipeline has already put the world's
// transform on the context before a component draws, so the transform kept at the
// call carries it.

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

/**
 * The runs of text the recorded calls drew, oldest first — one per call — and,
 * after them, one for each run the frame SPELLED in more than one call.
 *
 * The score and the wave are read here by the figure a run's digits make, and
 * a build that letter-spaces its HUD or its banner draws one digit per call:
 * the only portable way to letter-space canvas text, on a screen whose copy
 * `specs/ui.md` fixes and whose type it leaves to the build. Read a call at a
 * time, `4870` is four runs of one digit and no score. So `harness.ts`'s
 * `spelledTextRuns`, which coalesces side-by-side draws on one baseline back into
 * the string they spell, supplies a box per multi-call run as well — its extent
 * the run's, its height the union of its calls' — and a reader that finds its
 * figure in either has found it. The calls stay, because the merge can also
 * glue a figure onto a neighbour the build set a bare space away, and the call
 * that drew the figure whole is still the box it occupies.
 */
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
    const m = geometry?.transform;
    const text = call.args[0];
    const x = call.args[1];
    const y = call.args[2];
    if (
      geometry === undefined ||
      m === undefined ||
      typeof text !== "string" ||
      typeof x !== "number" ||
      typeof y !== "number"
    ) {
      continue;
    }
    // The anchor through the transform in force at the call, then back out of the
    // engine's own fit, so the box is in the logical units every spec figure is in.
    const anchorX = (m[0] * x + m[2] * y + m[4] - view.offsetX) / view.scale;
    const anchorY = (m[1] * x + m[3] * y + m[5] - view.offsetY) / view.scale;
    const alongX = Math.hypot(m[0], m[1]) / view.scale;
    const alongY = Math.hypot(m[2], m[3]) / view.scale;
    const width = geometry.width * alongX;
    const size = (fontPixels(font) ?? 10) * alongY;
    const left =
      geometry.textAlign === "center"
        ? anchorX - width / 2
        : geometry.textAlign === "right" || geometry.textAlign === "end"
          ? anchorX - width
          : anchorX;
    const top = anchorY - aboveAnchor(baseline) * size;
    runs.push({ at, text, left, right: left + width, top, bottom: top + size });
  }
  // The runs spelled across several calls, each as the box its calls span.
  const boxes = new Map(runs.map((run) => [run.at, run]));
  for (const run of spelledTextRuns(h, calls)) {
    if (run.parts.length < 2) continue;
    const members = run.parts.flatMap((part) => {
      const box = boxes.get(part.at);
      return box === undefined ? [] : [box];
    });
    if (members.length === 0) continue;
    runs.push({
      at: run.at,
      text: run.text,
      left: run.left,
      right: run.right,
      top: Math.min(...members.map((box) => box.top)),
      bottom: Math.max(...members.map((box) => box.bottom)),
    });
  }
  return runs;
}

/* -------------------------------------------------------------------------- */
/* A box of text, and what is immediately around it                           */
/* -------------------------------------------------------------------------- */
