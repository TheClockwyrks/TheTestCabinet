// water/phases-staggered — the eight water lanes do not line up into a solid
// bridge.
//
// specs/water.md draws WHERE each lane's pattern sits along its row when a
// level is laid out, and then conditions the draw: the phases are drawn
// "conditioned on the band being staggered: no column of the strait carries a
// floe in all eight water rows at once." It is the one property of the phases the
// specification fixes beyond their distribution: a column carrying a floe in
// every water row is a solid bridge the critter walks straight up, and the
// crossing is meant to be timed floe to floe.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md, which
// specs/water.md reads for a floe: an item covers a tile of its row when "that
// tile's center is covered". So for each of the forty columns the eight rows are
// counted, and no column may reach eight.
//
// ONE LEVEL, LAID OUT ONCE. The condition is stated of the draw itself, so it
// holds of the band this level was laid out with, and that band is what is read.
// How the phases spread across repeated layouts is the specification's business
// rather than this point's, so nothing here lays the band out again to gather a
// figure off the draws.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// floes at all carries no column in eight rows, and would pass a reading that
// only counted. specs/water.md requires each lane to carry enough floes to reach
// both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { COLS, WATER_LANES } from "../constants";
import {
  captureStill,
  coversTile,
  createHarness,
  type Harness,
} from "../harness";
import { floesAlong, layOutLevel } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/** How many water rows a column may carry a floe in: fewer than all eight. */
const ROWS_CARRYING_LIMIT = WATER_LANES.length;

/** One column of the laid-out band: how many of the eight rows carried a floe. */
interface ColumnReading {
  col: number;
  covered: number;
}

/** How many floes one lane carried. */
interface LaneReading {
  row: number;
  count: number;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("leaves no column carrying a floe in all eight water rows", async () => {
  const laid = await layOutLevel(harness, LEVEL);
  const rows = WATER_LANES.map((lane) => floesAlong(laid, lane.row));

  const lanes: LaneReading[] = rows.map((carried, index) => ({
    row: WATER_LANES[index].row,
    count: carried.length,
  }));
  const columns: ColumnReading[] = [];
  for (let col = 0; col < COLS; col += 1) {
    columns.push({
      col,
      covered: rows.filter((carried) =>
        carried.some((floe) => coversTile(floe, col)),
      ).length,
    });
  }
  await captureStill(harness, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `row ${lane.row}: a lane carries floes at all (specs/water.md)`,
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_CARRYING_LIMIT,
      `column ${reading.col}: the water rows carrying a floe over it, of ` +
        `${ROWS_CARRYING_LIMIT}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
