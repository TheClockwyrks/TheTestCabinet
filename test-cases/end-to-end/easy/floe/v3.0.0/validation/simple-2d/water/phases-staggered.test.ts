// water/phases-staggered — the eight water lanes never line up into a solid
// bridge.
//
// specs/water.md draws WHERE each lane's pattern sits along its row when a
// level is laid out, and then constrains the draw: "A draw that leaves some
// column of the strait carrying a floe in all eight water rows is drawn again,
// so the band is always staggered: no column of the strait carries a floe in
// all eight water rows at once." It is the one property of the phases the
// specification fixes beyond their distribution: a column carrying a floe in
// every water row is a solid bridge the critter walks straight up, and the
// crossing is meant to be timed floe to floe.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md, which
// specs/water.md reads for a floe: an item covers a tile of its row when "that
// tile's center is covered". So for each of the forty columns the eight rows are
// counted, and no column may reach eight.
//
// MANY DRAWS, NOT ONE. The phases are drawn when a level is laid out, and
// `setLevel` lays the level out again on a fresh draw (specs/instrumentation.md),
// so a single layout grades one draw. The rule is a property of the DRAW, so
// this takes many of them — a build that stated the rule and never enforced it
// lands a bridge on some draws and not others, and a build that enforces it
// lands none on any. The water band's gaps are narrow, so an unenforced draw
// bridges one of the forty columns in perhaps one draw in twenty, and `DRAWS`
// is a sample large enough to reach one. Nothing else varies between the draws:
// level 1, laid out the same way each time, and the draw and the column are
// named where one fails.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// floes at all carries no column in eight rows, and would pass a reading that
// only counted. specs/water.md requires each lane to carry enough floes to reach
// both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WATER_LANES } from "../constants";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import {
  captureStill,
  coversTile,
  createHarness,
  itemsInRow,
  type Harness,
} from "../harness";
import { layOutLevel, relayLevel } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/** How many times the band is laid out, one fresh draw of the phases each. */
const DRAWS = 96;

/** How many water rows a column may carry a floe in: fewer than all eight. */
const ROWS_COVERED_LIMIT = WATER_LANES.length;

/** One column of one draw: how many of the eight water rows carried a floe. */
interface ColumnReading {
  draw: number;
  col: number;
  covered: number;
}

/** How many floes one lane carried on one draw. */
interface LaneReading {
  draw: number;
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

it("leaves no column carrying a floe in all eight water rows, on every draw of the phases", async () => {
  const columns: ColumnReading[] = [];
  const lanes: LaneReading[] = [];

  for (let draw = 1; draw <= DRAWS; draw += 1) {
    const laid =
      draw === 1 ? await layOutLevel(h, LEVEL) : relayLevel(h, LEVEL);
    const rows = WATER_LANES.map((lane) => itemsInRow(laid.floes, lane.row));
    rows.forEach((carried, index) => {
      lanes.push({ draw, row: WATER_LANES[index].row, count: carried.length });
    });
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        draw,
        col,
        covered: rows.filter((carried) =>
          carried.some((floe) => coversTile(floe, col)),
        ).length,
      });
    }
  }
  captureStill(h, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `draw ${lane.draw}, row ${lane.row}: a lane carries floes at all ` +
        "(specs/water.md)",
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_COVERED_LIMIT,
      `draw ${reading.draw}, column ${reading.col}: the water rows carrying a ` +
        `floe over it, of ${ROWS_COVERED_LIMIT}`,
    );
  }
});
