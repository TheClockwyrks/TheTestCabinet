// presentation/water-reads-apart — open water reads apart from a floe drifting
// on it.
//
// specs/overview.md's legibility table: "Deep water reads apart from a floe on
// the same row." That is the reading a player's crossing rests on: the water
// band is the half of the strait with nothing to stand on, and every hop across
// it is a judgement about which tiles are floe and which are water. A build that
// draws the two alike hands the player a band they cannot read at all.
//
// THE TWO SAMPLES ARE ON THE SAME ROW, so they differ in the floe and in nothing
// else — not in the band's own shading, not in a gradient down the strait, not
// in whatever a build draws behind the water. A raft is posed at one end of the
// row and the open water is read several tiles clear of it, so neither sample
// falls on the other's edge.
//
// THE FLOE IS THE LONGEST ONE THE GAME HAS, a `raft4`, so the tile it is read on
// is squarely inside the slab rather than at a corner of it, and `poseLane`
// stops the lane so nothing drifts between the two readings.
//
// WHAT IS READ IS A DISTANCE, NEVER A COLOUR, and each sample is a small cluster
// well inside its tile: an expanse of water and a slab of floe are both flat
// enough for that reading, which is the same one `strait/bands-read-apart` takes
// between two bands.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { ITEM_LEN } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseLane,
  sampleTile,
  startCrossing,
  type Harness,
} from "../harness";
/**
 * How far the two readings must sit apart, as an RGB distance out of about `441`.
 *
 * `60` is a seventh of the cube's longest diagonal: the figure this review item
 * states, and the same one the bodies are held to
 * (`presentation/critter-reads-apart`). It is a DISTANCE — no colour, no channel
 * and no palette entry is asserted here, because specs/overview.md fixes none:
 * "The palette, the type, and every other aspect of the look are yours".
 */
const DISTINCT_MIN = 60;

/** A row inside the water band, emptied of everything but the posed raft. */
const WATER_ROW = 6;

/** The longest floe the game has, and where its left edge is posed. */
const FLOE_KIND = "raft4" as const;
const FLOE_COL = 8;

/** The tile of that raft the floe is read on: well inside the slab. */
const ON_FLOE_COL = FLOE_COL + 1;

/** A tile of the same row no floe covers, several tiles clear of the raft. */
const OPEN_COL = FLOE_COL + ITEM_LEN[FLOE_KIND] + 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws open water apart from a floe on the same row", async () => {
  // An emptied strait: `startCrossing` clears both rosters, so the only floe on
  // the water band is the one posed here.
  startCrossing(h);
  h.debug.removeCritter();
  poseLane(h, WATER_ROW, FLOE_KIND, [FLOE_COL]);
  await h.advance(1);
  // Before the assertion, so a failing verdict leaves the picture of the raft on
  // the open water it was read against.
  captureStill(h, "scene");

  const floe = sampleTile(h, ON_FLOE_COL, WATER_ROW);
  const water = sampleTile(h, OPEN_COL, WATER_ROW);

  assertGreaterThanOrEqual(
    colorDistance(floe, water),
    DISTINCT_MIN,
    `the floe at column ${ON_FLOE_COL} of row ${WATER_ROW} read against the ` +
      `open water at column ${OPEN_COL} of the same row — deep water reads ` +
      `apart from a floe on the same row (specs/overview.md)`,
  );
});
