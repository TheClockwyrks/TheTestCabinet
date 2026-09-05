// Refract — board/masks: reading a region of the rendered frame off the canvas.
//
// Private to the board category. The checks here decide one thing each off the
// pixels — cell-geometry, that the build drew something at a formula center;
// crystal-charges-read and beam-route, that a region's rendering moved when the
// state behind it moved — and they share one way of reading a region: every
// pixel within a radius of a logical point, taken in one `getImageData` over
// the canvas the engine drew into, in device pixels through the same viewport
// mapping `h.pixel` uses.
//
// NOTHING HERE DECIDES APPEARANCE. specs/board.md leaves the palette, the node
// artwork, the beam rendering and the background to the build, so a disk says
// whether the build drew anything inside it and a paired comparison says
// whether two renderings of one region differ at all. How any of it looks is
// the reviewer's presentation rating.

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

/**
 * The greatest distance from `ground` anywhere in a sampled disk: zero when
 * the build drew nothing there, and anything above it when the build drew.
 */
export function diskPeak(disk: readonly DiskPixel[], ground: Rgb): number {
  let peak = 0;
  for (const pixel of disk) {
    const distance = colorDistance(pixel.color, ground);
    if (distance > peak) peak = distance;
  }
  return peak;
}

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
