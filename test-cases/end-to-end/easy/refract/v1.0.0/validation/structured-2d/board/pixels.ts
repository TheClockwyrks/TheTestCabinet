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
// The masks are the checklist's "hue-independent" silhouette reading: a pixel
// belongs to a node's mask when it differs from the background sample by more
// than the checklist's own 50 of 441 line for a body clearly apart from the
// bench — the same figure the item descriptions quote — so the mask captures
// where the form IS, whatever hue the build chose for it. Two masks are
// compared by intersection-over-union after their centroids are aligned to the
// nearest whole pixel, so a form's identity is judged on shape alone and not on
// where inside its cell the build happened to center it.

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
 * The checklist's line for a body clearly apart from the bench, used here to
 * binarize a region: a pixel this far from the background belongs to the form.
 */
export const BINARIZE_MIN = 50;

/** A region binarized against `background`: `true` where the form is. */
export function maskRegion(region: Region, background: Rgb): boolean[] {
  return region.pixels.map(
    (pixel) => colorDistance(pixel, background) > BINARIZE_MIN,
  );
}

/** How many pixels a mask holds. */
export function maskArea(mask: readonly boolean[]): number {
  let area = 0;
  for (const bit of mask) if (bit) area += 1;
  return area;
}

/** A mask's centroid in region coordinates, or `null` for an empty mask. */
export function maskCentroid(
  mask: readonly boolean[],
  size: number,
): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let area = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!mask[y * size + x]) continue;
      sumX += x;
      sumY += y;
      area += 1;
    }
  }
  if (area === 0) return null;
  return { x: sumX / area, y: sumY / area };
}

/**
 * Intersection-over-union of two same-sized masks after their centroids are
 * aligned to the nearest whole pixel: `b` is shifted so the two forms sit on
 * top of one another, then overlap is counted. Two empty masks are identical
 * (IoU 1), and an empty mask against a non-empty one shares nothing (IoU 0) —
 * both degenerate readings a check turns into its own verdict.
 */
export function iouAfterAlignment(
  a: readonly boolean[],
  b: readonly boolean[],
  size: number,
): number {
  const ca = maskCentroid(a, size);
  const cb = maskCentroid(b, size);
  if (ca === null && cb === null) return 1;
  if (ca === null || cb === null) return 0;
  const dx = Math.round(ca.x - cb.x);
  const dy = Math.round(ca.y - cb.y);
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inA = a[y * size + x] === true;
      const sx = x - dx;
      const sy = y - dy;
      const inB =
        sx >= 0 &&
        sx < size &&
        sy >= 0 &&
        sy < size &&
        b[sy * size + sx] === true;
      if (inA && inB) intersection += 1;
      if (inA || inB) union += 1;
    }
  }
  return union === 0 ? 1 : intersection / union;
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
 * The board's own ground: the sampled center of the first empty cell of the
 * posed board.
 *
 * specs/board.md lets a build draw an empty cell as nothing OR as quiet
 * background texture, so inside the board's area the bench a node sits on is
 * the CELL GROUND, not necessarily the bare stage background off the board.
 * A reading that asks whether a point inside the board shows "nothing" —
 * an emitter's open center, the ring outside a node's radius — therefore
 * compares against this sample: it is what the build draws where no node
 * sits, and against the bare off-board background such a check would fail a
 * conformant build for its legal empty-cell texture.
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
 * The strongest reading of a node's drawn form about its center: the largest
 * RGB distance from `background` over the center cluster and rings swept
 * inside NODE_R. A FILLED form is loudest at the center itself; an OUTLINED
 * one is open there and loudest on its stroke (specs/board.md "Nodes"), so a
 * check that a node is DRAWN at a point reads the whole form, not one pixel.
 */
export function strongestAboutCenter(
  h: Harness,
  cx: number,
  cy: number,
  background: Rgb,
): number {
  let strongest = colorDistance(sampleColor(h, cx, cy), background);
  for (const radius of [8, 14, 20, 26]) {
    for (const point of ringPoints(cx, cy, radius, 24)) {
      const [r, g, b] = h.pixel(point.x, point.y);
      const d = colorDistance({ r, g, b }, background);
      if (d > strongest) strongest = d;
    }
  }
  return strongest;
}

/** `count` points evenly spaced on the circle of `radius` about `(cx, cy)`. */
export function ringPoints(
  cx: number,
  cy: number,
  radius: number,
  count: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
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
