// board/sampling — the pixel-region readings this category's suites share.
// PRIVATE to `board/`: the shared harness owns the single-point cluster
// (`sampleColor`) and the bench (`sampleBench`); what lives here is the
// region-sized readings only these suites take — a disk of samples around a
// cell center, the paired point-by-point distance two regions of the same shape
// are compared by, and the board's own ground the disk is read against.
//
// EVERY READING HERE IS A PRESENCE READING. specs/board.md leaves the palette,
// the node artwork, the beam rendering and the background to the build, so
// nothing here decides what a form looks like: a disk says whether the build
// drew anything inside it, and a paired comparison says whether two renderings
// of one region differ at all. How good any of it looks is the reviewer's
// presentation rating.

import type { Harness, Rgb } from "../harness";
import { colorDistance, sampleColor } from "../harness";
import { cellCenter, NODE_R, type Board } from "../notation";

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
 * exactly what a caller asking "did the rendering move" is looking for.
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

/**
 * The greatest distance from `ground` anywhere in a sampled disk: zero when
 * the build drew nothing there, and anything above it when the build drew.
 */
export function diskPeak(disk: DiskSample, ground: Rgb): number {
  let peak = 0;
  for (const color of disk.colors) {
    const distance = colorDistance(color, ground);
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
