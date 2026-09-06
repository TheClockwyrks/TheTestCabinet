// ice/phases-staggered — the eight ice lanes never line up into a wall.
//
// specs/ice.md draws WHERE each lane's pattern sits along its row when a level
// is laid out, and then constrains the draw: "A draw that leaves some column of
// the strait covered by a vehicle in all eight ice rows is drawn again, so the
// band is always staggered: no column of the strait is covered by a vehicle in
// all eight ice rows at once." It is the one property of the phases the
// specification fixes beyond their distribution, and it is the reason the band
// can be crossed at all — a column covered in all eight rows is eight closed
// tiles stacked on top of one another, and specs/hopping.md refuses a hop onto
// every one of them.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md: a vehicle covers
// a tile of its row when "that tile's center is covered". So for each of the
// forty columns the eight rows are counted, and no column may reach eight.
//
// MANY DRAWS, NOT ONE. The phases are drawn when a level is laid out, and
// `setLevel` lays the level out again on a fresh draw (specs/instrumentation.md),
// so a single layout grades one draw. The rule is a property of the DRAW, so
// this takes many of them — a build that stated the rule and never enforced it
// lands a wall on some draws and not others, and a build that enforces it lands
// none on any. Nothing else varies between the draws: level 1, laid out the
// same way each time, and the draw and the column are named where one fails.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// vehicles at all covers no column in eight rows, and would pass a reading that
// only counted. specs/ice.md requires each lane to carry enough vehicles to
// reach both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { COLS, ICE_LANES } from "../constants";
import {
  captureStill,
  coversTile,
  createHarness,
  type Harness,
} from "../harness";
import { layOutLevel, relayLevel, vehiclesAlong } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/** How many times the band is laid out, one fresh draw of the phases each. */
const DRAWS = 24;

/** How many ice rows a column may be covered in: fewer than all eight. */
const ROWS_COVERED_LIMIT = ICE_LANES.length;

/** One column of one draw: how many of the eight ice rows covered it. */
interface ColumnReading {
  draw: number;
  col: number;
  covered: number;
}

/** How many vehicles one lane carried on one draw. */
interface LaneReading {
  draw: number;
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

it("leaves no column covered in all eight ice rows, on every draw of the phases", async () => {
  const columns: ColumnReading[] = [];
  const lanes: LaneReading[] = [];

  for (let draw = 1; draw <= DRAWS; draw += 1) {
    const laid =
      draw === 1
        ? await layOutLevel(harness, LEVEL)
        : await relayLevel(harness, LEVEL);
    const rows = ICE_LANES.map((lane) => vehiclesAlong(laid, lane.row));
    rows.forEach((carried, index) => {
      lanes.push({ draw, row: ICE_LANES[index].row, count: carried.length });
    });
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        draw,
        col,
        covered: rows.filter((carried) =>
          carried.some((vehicle) => coversTile(vehicle, col)),
        ).length,
      });
    }
  }
  await captureStill(harness, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `draw ${lane.draw}, row ${lane.row}: a lane carries vehicles at all ` +
        `(specs/ice.md)`,
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_COVERED_LIMIT,
      `draw ${reading.draw}, column ${reading.col}: the ice rows covering it, ` +
        `of ${ROWS_COVERED_LIMIT}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
