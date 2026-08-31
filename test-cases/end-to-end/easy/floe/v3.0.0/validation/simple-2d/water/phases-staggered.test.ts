// water/phases-staggered — the eight water lanes never line up into a raft the
// whole way across.
//
// specs/water.md leaves WHERE each lane's pattern sits along its row to the
// game's own seeded randomness, and then constrains the draw: "The phases drawn
// leave the band staggered: no column of the strait carries a floe in all eight
// water rows at once." It is the one property of the phases the specification
// fixes.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md fixes it and
// specs/water.md reads it: an item covers a tile of its row when that tile's
// center lies in `[x, x + TILE * len)`, which `coversTile` is. So for each of
// the forty columns the eight rows are counted, and no column may reach eight.
//
// MANY SEEDS, NOT ONE. The phases are drawn from the generator `reset` seeds, so
// a single draw grades one draw, and a build that stated the rule and never
// enforced it still lays a staggered band most of the time. How often it does not
// follows from the lane table itself: a lane carries a floe over
// `len / (len + gap)` of its row, which the eight rows of specs/water.md put at
// `3/6, 4/7, 3/6, 1/3, 4/7, 3/6, 1/3, 4/7`, so an unconstrained draw covers any
// one column in all eight rows about once in four hundred, and some column of the
// forty in perhaps one draw in twenty. `SEEDS` is therefore a sample large enough
// that such a build is caught rather than sampled past — at one draw in twenty,
// ninety-six of them miss it with a probability near one in a hundred and fifty —
// while a build that enforces the rule lands no column on any draw and passes at
// any sample size. Nothing else varies between them: level 1, laid out the same
// way each time.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// floes at all carries no column in eight rows, and would pass a reading that
// only counted. specs/water.md requires each lane to carry enough floes to reach
// both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WATER_LANES } from "../../src/constants";
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

/** The seeds the phases are drawn from, one fresh draw of the band each. */
const SEEDS = Array.from({ length: 96 }, (_unused, index) => index + 1);

/** How many water rows a column may carry a floe in: fewer than all eight. */
const ROWS_COVERED_LIMIT = WATER_LANES.length;

/** One column of one draw: how many of the eight water rows carried a floe. */
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

  for (const seed of SEEDS) {
    const laid = await layOutLevel(h, LEVEL, { seed });
    const rows = WATER_LANES.map((lane) => itemsInRow(laid.floes, lane.row));
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
  captureStill(h, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `seed ${lane.seed}, row ${lane.row}: a lane carries floes at all ` +
        "(specs/water.md)",
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
});
