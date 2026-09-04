// Refract — board/masks: reading a node's drawn form off the rendered pixels.
//
// Private to the board category. The checks here compare what a node LOOKS
// like rather than any single color — silhouettes-distinct, crystal-distinct,
// crystal-charges-read, crystal-spent-reads, emitter-versus-lens, channel-hues,
// node-radius — and they
// share one way of reading a region: every pixel within a radius of a cell
// center, taken in one `getImageData` over the canvas the engine drew into, in
// device pixels through the same viewport mapping `h.pixel` uses.
//
// A node's form is read as a BODY MASK: that disc binarized against the board's
// own ground at half the form's own strongest reading. {@link bodyMask} says
// why the cut is relative and why the region is a disc; {@link groundSample}
// says why the comparand is the board's ground and not the bench off it. The
// binarization is hue-independent — a triangle and a square of two different
// hues binarize to their shapes alone — so comparing bodies compares form and
// never palette (specs/board.md: "channel identity reads by form as well as by
// hue").

import { colorDistance, sampleColor, type Harness, type Rgb } from "../harness";
import { cellCenter, type Board } from "../notation";

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
export function groundSample(h: Harness, board: Board): Rgb {
  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const center = cellCenter(col, row, board.cols, board.rows);
      return sampleColor(h, center.x, center.y);
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
 * in one `getImageData` over the canvas the engine drew into. Offsets are in
 * device pixels through the same fit `h.device` uses, so two discs of one
 * radius sample the same offsets in the same order. `at` overrides the line
 * the region is binarized at (see {@link binarizeDisc}).
 */
export function bodyMask(
  h: Harness,
  cx: number,
  cy: number,
  radius: number,
  ground: Rgb,
  at?: number,
): BodyMask {
  const view = h.engine.viewport();
  const disk = diskPixels(h, cx, cy, radius);
  return binarizeDisc(
    disk.map(({ dx, dy }) => ({ dx, dy })),
    1 / view.scale,
    disk.map(({ color }) => color),
    ground,
    at,
  );
}
