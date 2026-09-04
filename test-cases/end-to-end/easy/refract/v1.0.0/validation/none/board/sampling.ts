// board/sampling — the pixel-region readings this category's suites share.
// PRIVATE to `board/`: the shared harness owns the single-point cluster
// (`sampleColor`) and the bench (`sampleBench`); what lives here is the
// region-sized readings only these suites take — a disk of samples around a
// cell center, the body it binarizes to, the centroid-aligned
// intersection-over-union two bodies are compared by, and the paired
// point-by-point distance two regions of the same shape are compared by.
//
// Every figure is one the review items state: `DISTINCT_MIN` (50 of 441) is the
// case's line for a reading "clearly apart" from another. A node's form is read
// as a BODY MASK: the disk about its cell center binarized against the board's own
// ground at half the form's own strongest reading. {@link bodyMask} says why
// the cut is relative and why the region is a disc; {@link groundSample} says
// why the comparand is the board's ground and not the bench off it. The
// binarization is hue-independent — a triangle and a square of two different
// hues binarize to their shapes alone, and the comparison reads form.

import type { Harness, Rgb } from "../harness";
import { colorDistance, sampleColor } from "../harness";
import { cellCenter, NODE_R, type Board } from "../notation";

/** The case's "clearly apart" line: more than 50 of the 441 the RGB cube spans. */
export const DISTINCT_MIN = 50;

/** How far apart, in logical px, the disk's sample points sit on each axis. */
const SAMPLE_STRIDE = 2;

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
 * The default radius is `NODE_R`: the box a node's silhouette must fit inside
 * (`specs/board.md`), so a disk at a cell center reads the node and nothing of
 * its neighbours, which sit a full `CELL_PITCH` away.
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

/* -------------------------------------------------------------------------- */
/* The shared board primitives                                                */
/* -------------------------------------------------------------------------- */
//
// Three readings the whole category rests on: the board's own ground, a node's
// body, and the color that body is made of. They are the same in every
// engine project, in code and in wording, so one build is judged by the same
// reading whichever engine it was written for. Only how a disc of pixels is
// fetched differs, because that is the one thing the engines genuinely do
// differently.

/** The case's line for a reading clearly apart from the bench: 50 of 441. */
export const APART_MIN = 50;

/**
 * The board's own ground: the sampled center of an EMPTY CELL of the posed
 * board, read on the frame as it stands.
 *
 * specs/board.md leaves the background to the build — "It does not pin a
 * palette, a font, node artwork, beam rendering, a background, or animation" —
 * so a reading taken INSIDE the board's extent is compared against the board's
 * own ground rather than against a stage-edge sample, which on a build that
 * draws a vignette measures the vignette. An empty cell is what specs/board.md
 * says a cell shows when nothing fills it — "drawn as nothing, or as quiet
 * background texture of the build's choosing" — so it is the bench a node on
 * this board really sits on. A reading genuinely off the board keeps the
 * far-field bench sample.
 */
export async function groundSample(h: Harness, board: Board): Promise<Rgb> {
  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const center = cellCenter(col, row, board.cols, board.rows);
      return await sampleColor(h, center.x, center.y);
    }
  }
  throw new Error("the posed board holds no empty cell to sample");
}

/** A node's form, read off the rendered pixels and binarized against a ground. */
export interface BodyMask {
  /** Every sampled offset from the region's center, in whole sample steps. */
  offsets: readonly { dx: number; dy: number }[];
  /** Logical px per sample step: an offset sits `hypot(dx, dy) * unit` out. */
  unit: number;
  /** Whether each sampled offset stands in the body, in the same order. */
  inBody: readonly boolean[];
  /** The rendered color under each sampled offset, in the same order. */
  colors: readonly Rgb[];
  /** Each sampled offset's distance from the ground, in the same order. */
  distances: readonly number[];
  /** The greatest distance from the ground anywhere in the region. */
  peak: number;
  /** The line the body was binarized at: `max(APART_MIN, 0.5 * peak)`, or
   * whatever line the caller handed {@link bodyMask} instead. */
  cut: number;
}

/**
 * Binarize a sampled disc against `ground` at `max(APART_MIN, 0.5 * peak)`,
 * where `peak` is the greatest distance from the ground anywhere in the disc —
 * or at `at`, when the caller has already read that line off a smaller region.
 *
 * THE HALFWAY LINE IS THE SPECIFICATION'S OWN. specs/board.md item 4 of
 * "Presentation is yours" says a node's silhouette is drawn inside `NODE_R`,
 * and that a halo, a backing, or a highlight drawn around it may reach
 * `CELL_PITCH / 2` from the center, "and everywhere outside `NODE_R` it stays
 * faint: less than halfway from the background it is drawn on to the strongest
 * color the silhouette shows against that background". A pixel stands in the
 * BODY when it is at least that halfway, so the binarization draws exactly the
 * line the specification draws and invents no figure of its own.
 *
 * `at` exists because that line is measured against the strongest color THE
 * SILHOUETTE shows. A caller reading a region wider than `NODE_R` reads the cut
 * off the silhouette's own disc first and passes it in, so an ornament out in
 * the wider region cannot raise the line that is there to exclude it.
 *
 * The floor at `APART_MIN` keeps the cut from collapsing onto a bench carrying
 * nothing but its own quiet texture: below that line nothing in the region is a
 * form at all, and the body comes back empty, which is a caller's own verdict.
 */
function binarizeDisc(
  offsets: readonly { dx: number; dy: number }[],
  unit: number,
  colors: readonly Rgb[],
  ground: Rgb,
  at?: number,
): BodyMask {
  const distances = colors.map((color) => colorDistance(color, ground));
  let peak = 0;
  for (const distance of distances) if (distance > peak) peak = distance;
  const cut = at ?? Math.max(APART_MIN, 0.5 * peak);
  return {
    offsets,
    unit,
    inBody: distances.map((distance) => distance > cut),
    colors,
    distances,
    peak,
    cut,
  };
}

/** How many sampled offsets stand in the body. */
export function bodyArea(mask: BodyMask): number {
  let area = 0;
  for (const bit of mask.inBody) if (bit) area += 1;
  return area;
}

/** The farthest an in-body offset sits from the center, in logical px. */
export function bodyReach(mask: BodyMask): number {
  let reach = 0;
  for (const [index, offset] of mask.offsets.entries()) {
    if (!mask.inBody[index]) continue;
    const out = Math.hypot(offset.dx, offset.dy) * mask.unit;
    if (out > reach) reach = out;
  }
  return reach;
}

/**
 * The in-body share of the sampled offsets lying within `radius` logical px of
 * the center: how much of that inner disc the form covers, 0 to 1.
 */
export function bodyCoverage(mask: BodyMask, radius: number): number {
  let inside = 0;
  let covered = 0;
  for (const [index, offset] of mask.offsets.entries()) {
    if (Math.hypot(offset.dx, offset.dy) * mask.unit > radius) continue;
    inside += 1;
    if (mask.inBody[index]) covered += 1;
  }
  return inside === 0 ? 0 : covered / inside;
}

/**
 * The body's centroid, in logical px from the center, or null for an empty
 * body: where the mass of the drawn form sits relative to the point the region
 * was read about.
 */
export function bodyCentroid(mask: BodyMask): { x: number; y: number } | null {
  const steps = stepCentroid(mask);
  if (steps === null) return null;
  return { x: steps.x * mask.unit, y: steps.y * mask.unit };
}

/** The body's centroid in whole sample steps, or null for an empty body. */
function stepCentroid(mask: BodyMask): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let area = 0;
  for (const [index, offset] of mask.offsets.entries()) {
    if (!mask.inBody[index]) continue;
    sumX += offset.dx;
    sumY += offset.dy;
    area += 1;
  }
  return area === 0 ? null : { x: sumX / area, y: sumY / area };
}

/**
 * The color a node's form is made of: the median of its body's pixels, read
 * channel by channel. An empty body has no color and reads as black, which is
 * a caller's own verdict.
 *
 * specs/board.md fixes that the three channel hues are distinct and told apart
 * at a glance. It does not fix WHERE in a node its hue is shown, and a build
 * may lay an iris, a socket, or a bevel over the very center of the form, so
 * the center pixel is not the channel's hue.
 *
 * NOR IS THE BODY'S LOUDEST PIXEL. Read as the pixel standing farthest from the
 * ground, the reading lands on whatever a node wears that is most extreme
 * against its background — on a dark board a white specular pip or a white
 * outline, and not the hue underneath it. Three lenses each wearing the same
 * pip would then report one and the same color and read as carrying no distinct
 * hues at all, which is the very verdict this reading exists to reach honestly.
 * The MEDIAN is the color the form is mostly made of: an ornament covering a
 * minority of the body cannot move it, in any direction, and no single pixel
 * decides.
 */
export function bodyColor(mask: BodyMask): Rgb {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (const [index, inBody] of mask.inBody.entries()) {
    if (!inBody) continue;
    reds.push(mask.colors[index].r);
    greens.push(mask.colors[index].g);
    blues.push(mask.colors[index].b);
  }
  if (reds.length === 0) return { r: 0, g: 0, b: 0 };
  return { r: middle(reds), g: middle(greens), b: middle(blues) };
}

/** The middle value of a non-empty list of numbers, sorted in place. */
function middle(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/**
 * Intersection-over-union of two bodies after their centroids are aligned to
 * the nearest whole sample step, so a form's identity is judged on shape alone
 * and not on where inside its cell the build happened to center it. Two bodies
 * sampled at the same radius share one grid, so their offsets compare directly.
 * An empty body shares nothing with anything; callers assert non-emptiness
 * first, and read the 0 as its own verdict if they do not.
 */
export function bodyIoU(a: BodyMask, b: BodyMask): number {
  const centroidA = stepCentroid(a);
  const centroidB = stepCentroid(b);
  if (centroidA === null || centroidB === null) return 0;
  const shiftX = Math.round(centroidA.x - centroidB.x);
  const shiftY = Math.round(centroidA.y - centroidB.y);
  const inA = new Set<string>();
  for (const [index, offset] of a.offsets.entries()) {
    if (a.inBody[index]) inA.add(`${offset.dx},${offset.dy}`);
  }
  let intersection = 0;
  let areaB = 0;
  for (const [index, offset] of b.offsets.entries()) {
    if (!b.inBody[index]) continue;
    areaB += 1;
    if (inA.has(`${offset.dx + shiftX},${offset.dy + shiftY}`)) {
      intersection += 1;
    }
  }
  const union = inA.size + areaB - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * The body of the form drawn within `radius` (logical px) of `(cx, cy)`, read
 * on the `SAMPLE_STRIDE` grid in one crossing into the page. Offsets are in
 * whole strides, so two discs of one radius sample the same offsets in the same
 * order.
 */
export async function bodyMask(
  h: Harness,
  cx: number,
  cy: number,
  radius: number,
  ground: Rgb,
  at?: number,
): Promise<BodyMask> {
  const steps = Math.floor(radius / SAMPLE_STRIDE);
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -steps; dy <= steps; dy += 1) {
    for (let dx = -steps; dx <= steps; dx += 1) {
      const out = Math.hypot(dx, dy) * SAMPLE_STRIDE;
      if (out <= radius) offsets.push({ dx, dy });
    }
  }
  const read = await h.pixels(
    offsets.map(({ dx, dy }) => ({
      x: cx + dx * SAMPLE_STRIDE,
      y: cy + dy * SAMPLE_STRIDE,
    })),
  );
  return binarizeDisc(
    offsets,
    SAMPLE_STRIDE,
    read.map(([r, g, b]) => ({ r, g, b })),
    ground,
    at,
  );
}
