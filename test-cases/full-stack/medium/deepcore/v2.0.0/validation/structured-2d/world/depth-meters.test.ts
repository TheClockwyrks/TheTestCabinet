// world/depth-meters — depth is reported in meters from the surface.
//
// `specs/world.md`: "a miner whose feet rest at world `y` is at
// `max(0, (y - SURFACE_Y) / TILE * METERS_PER_ROW)` meters, so the top of `row r`
// is at `METERS_PER_ROW * (r - 1)` meters", with `SURFACE_Y` `80`, `TILE` `80`
// and `METERS_PER_ROW` `5`. `specs/instrumentation.md` has `depthMeters` derived
// from the miner's position rather than stored, so it follows wherever the miner
// is put.
//
// Four readings decide it, and each is the formula at a different place in the
// mine: the camp ground itself, which reads `0`; two depths inside the mine; and
// the open sky above the camp, where the `max(0, ...)` clamps a negative depth to
// `0` rather than reporting the miner as being above the surface by a negative
// number of meters.
//
// HOW THE MINER IS HELD AT EACH DEPTH. It stands on a cell posed under it, so the
// reading is taken off a miner the game itself has settled rather than off one
// pinned in mid-air: the position it reports is one its own collision agreed to.
// The drill is held throughout, because a cut is not what is being read.

import { afterEach, beforeEach, it } from "vitest";
import { METERS_PER_ROW, TILE } from "../../src/constants";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  minerXOn,
  openScene,
  pinDrill,
  placeAt,
  standOn,
  type Harness,
} from "../harness";

const COL = 8;

/** The rows the miner is stood on, one per band of the reading. */
const ROWS = [1, 21, 101, 301] as const;

/** How far above the camp ground the sky reading is taken, in world units. */
const SKY_HEIGHT = 5 * TILE;

/**
 * The meters one world unit is worth: the slack a standing reading is taken to.
 *
 * A miner at rest has its feet against the top face of the cell beneath it, and
 * the frame that resolved the contact may leave it a fraction of that frame's
 * travel short of the face. One unit of the eighty a tile spans is the honest
 * bound on that, and this is what it is worth in meters.
 */
const UNIT_METERS = METERS_PER_ROW / TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports 5 meters per row of depth below the surface, and 0 above it", async () => {
  openScene(h);
  pinDrill(h);

  for (const row of ROWS) {
    h.debug.setTile(COL, row, "rock");
    standOn(h, COL, row);
    await h.advance(2);
    // The feet rest on the top of `row`, which the specification puts at
    // `METERS_PER_ROW * (row - 1)` meters.
    const stated = METERS_PER_ROW * (row - 1);
    assertBetween(
      h.snapshot().depthMeters,
      stated - UNIT_METERS,
      stated + UNIT_METERS,
      `standing on row ${row}`,
    );
  }

  // The picture: the miner at the deepest of those depths.
  captureStill(h, "depth");

  // And above the ground line the depth is clamped rather than signed.
  placeAt(h, minerXOn(COL), -SKY_HEIGHT);
  await h.advance(1);
  assertCloseTo(h.snapshot().depthMeters, 0, 6, "in the sky above the camp");
});
