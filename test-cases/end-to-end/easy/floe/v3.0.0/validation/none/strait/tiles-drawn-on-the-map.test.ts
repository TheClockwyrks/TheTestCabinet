// strait/tiles-drawn-on-the-map — the critter is DRAWN at the centre the
// tile-to-stage map gives, on the same eight tiles the reported centre is read
// on.
//
// specs/strait.md fixes `tileCX(c) = 32 * c + 16` and
// `tileCY(r) = 80 + 32 * r + 16`, and specs/assets.md draws the critter's 32 x 32
// frame "over one tile, centered on its subject's own center". So the draw that
// puts the critter on tile `(c, r)` is centred on that tile's centre.
//
// THE DRAWN HALF OF ONE SCENARIO, AND WHY IT IS AN ITEM OF ITS OWN. Reporting the
// right centre and drawing at it fail independently: a build whose snapshot is
// exact and whose render is a few units off is entirely playable, which is why
// this half is `presentation` and `scuffed` while `strait/tile-map` is `crossing`
// and `broken`.
//
// SO THE TARGET IS THE MAP, NOT THE SNAPSHOT. Every reading below is taken
// against `tileCX(col)`, `tileCY(row)` computed here from the specification's own
// formula, never against the centre the build reported. A build that reports a
// wrong centre and faithfully draws at it fails this item as well as the other,
// which is the honest verdict: it drew the critter in the wrong place.
//
// WHAT IS READ IS THE DRAW, NOT THE PIXELS. Floe fixes no palette, so a stage
// sample would grade the build's tint; what is captured instead is every
// `drawImage` the frame issued with the bitmap it was handed, matched pixel for
// pixel against the seeded PNGs, and the reading is where the box that carried a
// frame of `assets/crosser/` was centred. specs/assets.md lets a build reuse a
// crosser frame for a lives icon in the HUD — that icon is at least sixty-four
// units above the topmost tile read here, well outside the half-tile this item
// allows, so it is not what is found.
//
// THE WATER-BAND TILES CARRY A FLOE, because a frame has to RUN for the critter
// to be drawn at all and a critter whose footing is `water` falls in on that very
// tick (specs/water.md). `./harness.ts`'s `poseOnMeasuredTile` lays the smallest
// floe the game has under exactly the tile being read and clears it again
// afterwards; it is what makes the tile a tile a critter can be on, not a
// bystander parked nearby.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { TILE, tileCX, tileCY } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  startCrossing,
  type Harness,
} from "../harness";
import { MEASURED_TILES, poseOnMeasuredTile } from "./harness";

/**
 * How far the drawn box's centre may sit from the map's centre, in stage units.
 *
 * Half a tile, which is the item's own figure and the widest this can be and
 * still name one tile: a draw further off than that is centred on a neighbouring
 * tile and is some other body's. A build that draws where specs/assets.md and
 * specs/strait.md put it measures zero, and the missing `STRAIT_TOP` this
 * scenario is spread to catch measures eighty.
 */
const DRAWN_WITHIN = TILE / 2;

/** One tile's reading: how many crosser frames landed on the map's centre. */
interface Reading {
  tile: (typeof MEASURED_TILES)[number];
  at: { x: number; y: number };
  drawn: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the critter on the map's centre on each of the eight measured tiles", async () => {
  // An emptied, live strait: no vehicle, no bear and no bonus catch, so the only
  // body drawn from the seeded art is the critter and whatever floe holds it up.
  await startCrossing(h);

  const readings: Reading[] = [];
  for (const tile of MEASURED_TILES) {
    await poseOnMeasuredTile(h, tile);
    // `blitsOfFrame` runs the frame itself and hands back its draws.
    const blits = await blitsOfFrame(h);
    const at = { x: tileCX(tile.col), y: tileCY(tile.row) };
    readings.push({
      tile,
      at,
      drawn: drawnFrom(blits, "crosser", at, DRAWN_WITHIN).length,
    });
  }

  // The last tile's frame is still on the canvas; kept before the assertions so
  // a failing verdict leaves a picture behind.
  await captureStill(h, "tiles");

  for (const { tile, at, drawn } of readings) {
    assertGreaterThanOrEqual(
      drawn,
      1,
      `a frame of assets/crosser/ drawn within ${DRAWN_WITHIN} units of ` +
        `(${at.x}, ${at.y}), the centre the map gives tile ` +
        `(${tile.col}, ${tile.row}) — ${tile.band} (specs/strait.md, specs/assets.md)`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(h.pageErrors, []);
});
