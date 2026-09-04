// water/phases-staggered — the eight water lanes never line up into a wall.
//
// specs/water.md leaves WHERE each lane's pattern sits along its row to the
// game's own seeded randomness, and then constrains the draw: "The phases drawn
// leave the band staggered: no column of the strait carries a floe in all eight
// water rows at once." It is the one property of the phases the specification
// fixes, and on the water band it is the property that keeps the band from being
// a solid raft the length of a column — eight rows of footing stacked one above
// another, which a critter could walk straight up without the water ever
// deciding anything.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md, which
// specs/water.md reads "the same rule" from, has an item cover a tile of its row
// when "that tile's center is covered", which `coversTile` is. So for each of
// the forty columns the eight rows are counted, and no column may reach eight.
//
// MANY SEEDS, NOT ONE. The phases are drawn from the generator `reset` seeds, so
// a single draw grades one draw. The rule is a property of the DRAW, and what a
// suite can do about that is take enough of them: the water band's floes are
// dense — a lane covers between a third and four sevenths of its row — so a band
// drawn with no regard to the rule stacks all eight rows over some column on
// something like one draw in ten. The twenty-four below therefore catch such a
// build most of the time rather than certainly, which is the honest ceiling on a
// check about a random draw; a build that ENFORCES the rule passes every one of
// them, on every seed there is. Nothing else varies between the draws: level 1,
// laid out the same way each time.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// floes at all covers no column in eight rows, and would pass a reading that
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

/** The seeds the phases are drawn from, one fresh draw of the band each. */
const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);

/** How many water rows a column may carry a floe in: fewer than all eight. */
const ROWS_COVERED_LIMIT = WATER_LANES.length;

/** One column of one draw: how many of the eight water rows carried a floe over it. */
interface ColumnReading {
  seed: number;
  col: number;
  covered: number;
}

/** How many floes one lane carried on one draw. */
interface LaneReading {
  seed: number;
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

it("leaves no column carrying a floe in all eight water rows, on every draw of the phases", async () => {
  const columns: ColumnReading[] = [];
  const lanes: LaneReading[] = [];

  for (const seed of SEEDS) {
    const laid = await layOutLevel(harness, LEVEL, { seed });
    const rows = WATER_LANES.map((lane) => floesAlong(laid, lane.row));
    rows.forEach((carried, index) => {
      lanes.push({ seed, row: WATER_LANES[index].row, count: carried.length });
    });
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        seed,
        col,
        covered: rows.filter((carried) =>
          carried.some((floe) => coversTile(floe, col)),
        ).length,
      });
    }
  }
  await captureStill(harness, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `seed ${lane.seed}, row ${lane.row}: a lane carries floes at all ` +
        `(specs/water.md)`,
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_COVERED_LIMIT,
      `seed ${reading.seed}, column ${reading.col}: the water rows carrying a ` +
        `floe over it, of ${ROWS_COVERED_LIMIT}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
