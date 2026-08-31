// presentation — how the three "reads apart" points read a body against the
// band under it.
//
// WHY NOT A CLUSTER AVERAGE. The harness's `sampleColor` averages a small
// cluster, which is the right reading for a flat band and the WRONG one for a
// sprite. specs/assets.md seeds every body as pixel art with "a transparent
// background in straight alpha, so only its drawn pixels are opaque" — so most
// of the tile a 32 x 32 frame is drawn over is the band showing through, and
// averaging the body together with the band it is meant to be told apart from
// washes the body away. Measured on this case's own seeded frames, the
// critter's are about a sixth opaque and the bear's about a third; a cluster
// average of the tile's centre reads under half the distance its body pixels
// do.
//
// SO THE READING IS PER PIXEL, over the whole tile the frame covers, and what a
// point asserts is how MUCH of that tile reads apart from the band. That is the
// requirement as specs/overview.md states it — the critter and the bear are
// read "at a glance" against the band under them — and it is decided without
// any palette, hue or channel entering into it: the band is whatever the build
// drew beside the body, and the distance is against that.
//
// Local to this group because reading a body against its footing is the
// presentation group's own business, and the two figures each point rests on —
// how far apart is apart, and how much of the tile must be — are stated in the
// points themselves, not here.

import { tileCX, tileCY } from "../../src/constants";
import { TILE } from "../../src/constants";
import { colorDistance, type Rgb } from "../harness";
import type { Raster } from "./raster";

/**
 * How far apart two samples of the tile are taken, in stage units.
 *
 * Two units, so the 32-unit tile a body's frame covers is read as a 16 x 16
 * grid of 256 points. Fine enough that a body occupying a modest part of the
 * tile is caught at that proportion, coarse enough to cross into the page once.
 */
const SAMPLE_STEP = 2;

/**
 * Every pixel of the tile at `(col, row)`, as its RGB distance from `band`,
 * sorted ascending.
 *
 * The tile is the box a 32 x 32 frame is drawn over: specs/assets.md draws one
 * "over one tile, centered on its subject's own center", and specs/strait.md
 * puts that centre at `tileCX(col)`, `tileCY(row)`.
 */
export function bodyDistances(
  raster: Raster,
  col: number,
  row: number,
  band: Rgb,
): number[] {
  const distances: number[] = [];
  for (let dy = -TILE / 2 + 1; dy < TILE / 2; dy += SAMPLE_STEP) {
    for (let dx = -TILE / 2 + 1; dx < TILE / 2; dx += SAMPLE_STEP) {
      distances.push(
        colorDistance(raster.at(tileCX(col) + dx, tileCY(row) + dy), band),
      );
    }
  }
  return distances.sort((a, b) => a - b);
}

/** What fraction of those samples sit at least `min` from the band. */
export function fractionAtLeast(
  distances: readonly number[],
  min: number,
): number {
  if (distances.length === 0) return 0;
  return (
    distances.filter((distance) => distance >= min).length / distances.length
  );
}

/** The farthest of those samples, for a failure that says how close it came. */
export function farthest(distances: readonly number[]): number {
  return distances.length === 0 ? 0 : distances[distances.length - 1];
}
