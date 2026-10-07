// strait — the eight tiles `tile-map` and `tiles-drawn-on-the-map` are read on.
//
// The two points are deliberately one scenario read two ways: `tile-map` asks
// what the game REPORTS as the critter's centre on a tile, and
// `tiles-drawn-on-the-map` asks where the critter is DRAWN on that same tile. So
// "those same eight tiles" is one list, stated once, here.
//
// WHY THESE EIGHT. `specs/strait.md` fixes one map for the whole grid —
// `tileCX(c) = 32 * c + 16`, `tileCY(r) = 80 + 32 * r + 16` — and a wrong map is
// wrong in one of a few ways: an origin at the top of the STAGE rather than the
// top of the strait (the `80` dropped), a corner-anchored tile (the `16`
// dropped), a transposed pair, or a grid whose step is not `TILE`. Eight tiles
// spread over both axes tell those apart, because each wrong map misses by a
// different amount on a different tile:
//
//   - both grid corners are in, so a build whose columns or rows run the other
//     way reads the opposite end of the strait;
//   - no two tiles share a column or a row, so a build that transposed the pair
//     lands on none of them;
//   - the columns are not multiples of the rows and neither runs in even steps,
//     so a scale error shows as a different miss on every tile;
//   - every band is represented — the cap, the bay row, the water band, the
//     median, the ice band and the near shore — so a build that laid one band
//     out on its own coordinates is read on it.
//
// The bay row is represented by column `2`, which no bay covers
// (specs/strait.md fixes the five pairs, the leftmost being `3`, `4`). A tile is
// posed onto and a frame is run on it, and a bay's mouth is where a crossing
// ENDS (specs/bays.md) — the one tile of row `1` where running a frame could
// have the game do something other than stand still. The map is the same on
// every column of the row, so the reading loses nothing by taking a solid one.
//
// The near shore tile is LAST on purpose: it is the only tile in the list a
// frame can safely run on with nothing else posed — row `19` is solid ice
// (specs/strait.md) — and both points leave the critter there for the still they
// capture.

import type { Tile } from "../harness";

/** The eight tiles both points measure, in the order they are read. */
export const MEASURED_TILES: readonly Tile[] = [
  { col: 39, row: 0 },
  { col: 2, row: 1 },
  { col: 7, row: 3 },
  { col: 12, row: 8 },
  { col: 20, row: 10 },
  { col: 26, row: 12 },
  { col: 33, row: 15 },
  { col: 0, row: 19 },
];

/**
 * The tile the still is captured on: the near shore, the last of the eight.
 *
 * A picture needs a frame to have run, and a frame run on any of the other seven
 * would put the critter's own rules in the way of the reading — the water band
 * drowns it (specs/water.md) — so the one tile a bare frame is quiet on is the
 * one the picture is taken on.
 */
export const STILL_TILE: Tile = MEASURED_TILES[MEASURED_TILES.length - 1];
