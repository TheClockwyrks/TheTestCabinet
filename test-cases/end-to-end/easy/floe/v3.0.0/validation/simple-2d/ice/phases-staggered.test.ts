// ice/phases-staggered — the eight ice lanes do not line up into a wall.
//
// specs/ice.md draws WHERE each lane's pattern sits along its row when a level
// is laid out, and then conditions the draw: the phases are drawn "conditioned
// on the band being staggered: no column of the strait is covered by a vehicle
// in all eight ice rows at once." It is the one property of the phases the
// specification fixes beyond their distribution, and it is the reason the band
// can be crossed at all — a column covered in all eight rows is eight closed
// tiles stacked on top of one another, and specs/hopping.md refuses a hop onto
// every one of them.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md: a vehicle covers
// a tile of its row when "that tile's center is covered". So for each of the
// forty columns the eight rows are counted, and no column may reach eight.
//
// ONE LEVEL, LAID OUT ONCE. The condition is stated of the draw itself, so it
// holds of the band this level was laid out with, and that band is what is read.
// How the phases spread across repeated layouts is the specification's business
// rather than this point's, so nothing here lays the band out again to gather a
// figure off the draws.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// vehicles at all covers no column in eight rows, and would pass a reading that
// only counted. specs/ice.md requires each lane to carry enough vehicles to
// reach both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ICE_LANES } from "../constants";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import {
  captureStill,
  coversTile,
  createHarness,
  itemsInRow,
  type Harness,
} from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/** How many ice rows a column may be covered in: fewer than all eight. */
const ROWS_COVERED_LIMIT = ICE_LANES.length;

/** One column of the laid-out band: how many of the eight ice rows covered it. */
interface ColumnReading {
  col: number;
  covered: number;
}

/** How many vehicles one lane carried. */
interface LaneReading {
  row: number;
  count: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves no column covered in all eight ice rows", async () => {
  const laid = await layOutLevel(h, LEVEL);
  const rows = ICE_LANES.map((lane) => itemsInRow(laid.vehicles, lane.row));

  const lanes: LaneReading[] = rows.map((carried, index) => ({
    row: ICE_LANES[index].row,
    count: carried.length,
  }));
  const columns: ColumnReading[] = [];
  for (let col = 0; col < COLS; col += 1) {
    columns.push({
      col,
      covered: rows.filter((carried) =>
        carried.some((vehicle) => coversTile(vehicle, col)),
      ).length,
    });
  }
  captureStill(h, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `row ${lane.row}: a lane carries vehicles at all (specs/ice.md)`,
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_COVERED_LIMIT,
      `column ${reading.col}: the ice rows covering it, of ` +
        `${ROWS_COVERED_LIMIT}`,
    );
  }
});
