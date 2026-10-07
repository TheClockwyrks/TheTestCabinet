// strait/tile-map — a tile's centre is where the tile-to-stage map puts it, and
// the game reports it there.
//
// specs/strait.md fixes the six conversions between a tile and a stage position
// and says "every conversion between a tile and a stage position in this game is
// one of these six, and no other form is used". Two of the six place a body:
//
//   tileCX(c) = 32 * c + 16
//   tileCY(r) = 80 + 32 * r + 16
//
// THE READING IS THE GAME'S OWN. `specs/instrumentation.md` reports the critter's
// `x`/`y` as its CENTRE and `setCritterTile(col, row)` moves it "to a tile, its
// center on that tile's center", so posing the critter on a tile and reading its
// centre back asks the build for exactly the number the map fixes — computed by
// the build's own arithmetic, not by the pose's. A build whose `tileTop` forgot
// `STRAIT_TOP` reads eighty units high at every row; one whose `tileCX` measures
// from a tile's edge rather than its centre reads sixteen units left at every
// column; one that mapped the grid onto the whole stage rather than onto the
// strait reads a scaled `y`.
//
// EIGHT TILES, SPREAD THREE WAYS. `./harness.ts` names them and says why: both
// extreme columns, the bottom row and the bay row, and one tile in each of the
// five bands. A single mid-strait tile flatters every one of those wrong maps.
//
// NO TICK RUNS BETWEEN THE POSE AND THE READING. What the map fixes is a
// position, not a behaviour, and three of the eight tiles are in the water band
// where a tick would carry the critter's fate off to `specs/water.md`. The
// picture is taken afterwards, separately.
//
// This is the REPORTED half of one scenario. Where the build DRAWS the critter is
// `strait/tiles-drawn-on-the-map`, an item of its own, because a build that
// reports the right centre and draws a few units off is entirely playable.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual } from "../assert";
import { tileCX, tileCY } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { MEASURED_TILES, poseOnMeasuredTile } from "./harness";

/**
 * How many decimal places the reported centre must agree to.
 *
 * `specs/strait.md` states the map as exact integer arithmetic on whole units,
 * and every centre it gives is a whole number, so "exactly" is what this item
 * asks for. Six places allows a build that carries its positions as doubles
 * through a scale-and-unscale and nothing else: half a millionth of a unit is
 * far below any figure the specification names and far below one device pixel at
 * any density.
 */
const CENTRE_DIGITS = 6;

/** One tile's reading: where the game says the critter's centre is. */
interface Reading {
  tile: (typeof MEASURED_TILES)[number];
  x: number;
  y: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the critter's centre at the map's centre on each of the eight measured tiles", async () => {
  // An emptied, live strait: no vehicle, no floe, no bear and no bonus catch, so
  // nothing on it can move the critter between the pose and the reading.
  await startCrossing(h);

  const readings: Reading[] = [];
  for (const tile of MEASURED_TILES) {
    await h.debug.setCritterTile(tile.col, tile.row);
    const { critter } = await h.snapshot();
    readings.push({ tile, x: critter.x, y: critter.y });
  }

  // The picture, taken after every reading: the critter on the last of the eight
  // — the middle bay of the far shore — with one frame run so the still has
  // something on it. It is captured before the assertions so a failing verdict
  // still leaves the strait the readings were taken on.
  await poseOnMeasuredTile(h, MEASURED_TILES[MEASURED_TILES.length - 1]);
  await h.step();
  await captureStill(h, "tiles");

  for (const { tile, x, y } of readings) {
    const where = `(${tile.col}, ${tile.row}), ${tile.band}`;
    assertCloseTo(
      x,
      tileCX(tile.col),
      CENTRE_DIGITS,
      `the critter's centre x on tile ${where}: tileCX(c) = 32 * c + 16 (specs/strait.md)`,
    );
    assertCloseTo(
      y,
      tileCY(tile.row),
      CENTRE_DIGITS,
      `the critter's centre y on tile ${where}: tileCY(r) = 80 + 32 * r + 16 (specs/strait.md)`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
