// Refract — board/pixels: the pixel-region readings the Board and rendering
// category's checks share. PRIVATE to this category.
//
// Every reading here is over the DEFAULT harness surface — a canvas the size of
// the logical stage at a device pixel ratio of 1 — where one logical unit is one
// device pixel, so a rectangle of logical points is one `getImageData` rect.
// The corner is still mapped through `h.device`, so a build that moved the
// camera is read where its pixels really landed rather than where they should
// have been.
//
// NOTHING HERE DECIDES APPEARANCE. specs/board.md leaves the palette, the node
// artwork, the beam rendering and the background to the build, so a region says
// whether the build drew anything inside it ({@link regionPeak}, against the
// board's own ground) and a paired comparison says whether two renderings of
// one region differ at all ({@link maxRegionDifference}). How any of it looks
// is the reviewer's presentation rating. {@link groundSample} says why the
// comparand is the board's ground and not the bench off it.

import { colorDistance, sampleColor, type Harness, type Rgb } from "../harness";
import { cellCenter, type Board } from "../notation";

/** A square of rendered pixels, row-major, centered on a logical point. */
export interface Region {
  /** Pixels per side: `2 * radius + 1`. */
  size: number;
  /** Row-major RGB values, `size * size` of them. */
  pixels: Rgb[];
}

/**
 * The rendered pixels within `radius` of the logical point `(cx, cy)`, read as
 * one square block. On the default surface the block is `(2r+1)` device pixels
 * a side; the top-left corner is mapped through the engine's fit.
 */
export function readRegion(
  h: Harness,
  cx: number,
  cy: number,
  radius: number,
): Region {
  const size = 2 * radius + 1;
  const corner = h.device(cx - radius, cy - radius);
  const { data } = h.ctx.getImageData(corner.x, corner.y, size, size);
  const pixels: Rgb[] = [];
  for (let i = 0; i < size * size; i += 1) {
    pixels.push({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] });
  }
  return { size, pixels };
}

/**
 * The largest RGB distance between the same-positioned pixels of two regions:
 * how much the two renderings differ, at the point they differ most. Zero for
 * two identical regions.
 */
export function maxRegionDifference(a: Region, b: Region): number {
  let largest = 0;
  const count = Math.min(a.pixels.length, b.pixels.length);
  for (let i = 0; i < count; i += 1) {
    const d = colorDistance(a.pixels[i], b.pixels[i]);
    if (d > largest) largest = d;
  }
  return largest;
}

/**
 * The rendered colour at the midpoint of the segment joining `a` and `b`,
 * averaged over a five-point cluster laid ALONG the segment (the midpoint and
 * two points 4 and 8 logical units toward each end). A beam is a stroke of the
 * build's own width, so a cluster spread across it would dilute a thin stroke
 * with bench pixels; every point of this one sits on the line the beam
 * visibly connects (specs/board.md: a drawn beam connects the centers of the
 * cells it links), so the reading is of the beam itself.
 */
export function sampleMidpointAlong(
  h: Harness,
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rgb {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  let r = 0;
  let g = 0;
  let bch = 0;
  const steps = [-8, -4, 0, 4, 8];
  for (const t of steps) {
    const [pr, pg, pb] = h.pixel(mx + t * ux, my + t * uy);
    r += pr;
    g += pg;
    bch += pb;
  }
  return { r: r / steps.length, g: g / steps.length, b: bch / steps.length };
}

/* -------------------------------------------------------------------------- */
/* The board's own ground                                                     */
/* -------------------------------------------------------------------------- */
//
// The one reading the whole category rests on, and it is the same in every
// engine project, in code and in wording, so one build is judged by the same
// reading whichever engine it was written for. Only how a region of pixels is
// fetched differs, because that is the one thing the engines genuinely do
// differently.

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

/**
 * The greatest distance from `ground` anywhere in a read region: zero when the
 * build drew nothing there, and anything above it when the build drew.
 */
export function regionPeak(region: Region, ground: Rgb): number {
  let peak = 0;
  for (const pixel of region.pixels) {
    const distance = colorDistance(pixel, ground);
    if (distance > peak) peak = distance;
  }
  return peak;
}
