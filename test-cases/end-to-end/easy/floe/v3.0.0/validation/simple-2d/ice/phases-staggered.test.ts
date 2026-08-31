// ice/phases-staggered — the eight ice lanes never line up into a wall.
//
// specs/ice.md leaves WHERE each lane's pattern sits along its row to the game's
// own seeded randomness, and then constrains the draw: "The phases drawn leave
// the band staggered: no column of the strait is covered by a vehicle in all
// eight ice rows at once." It is the one property of the phases the
// specification fixes, and it is the reason the band can be crossed at all — a
// column covered in all eight rows is eight closed tiles stacked on top of one
// another, and specs/hopping.md refuses a hop onto every one of them.
//
// THE READING IS THE COVERING RULE, NOTHING ELSE. specs/ice.md: a vehicle covers
// a tile of its row when "that tile's center is covered", which `coversTile`
// is. So for each of the forty columns the eight rows are counted, and no column
// may reach eight.
//
// MANY SEEDS, NOT ONE. The phases are drawn from the generator `reset` seeds, so
// a single draw grades one draw, and the rule is a property of the DRAW.
//
// WHAT THAT CAN AND CANNOT CATCH, stated plainly. A wall is a rare arrangement —
// with the level-1 table a given column is covered in all eight rows on well
// under a thousandth of draws — so a build that enforces the rule and a build
// that merely got lucky look alike over any number of seeds a validator can
// afford. What these draws decide is the thing the item states: that no level
// this case lays out puts a wall in front of the critter. A build that lays one
// down on a seed read here fails, and the seed and the column are named. Nothing
// else varies between the draws: level 1, laid out the same way each time.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// vehicles at all covers no column in eight rows, and would pass a reading that
// only counted. specs/ice.md requires each lane to carry enough vehicles to
// reach both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ICE_LANES } from "../../src/constants";
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
const SEEDS = Array.from({ length: 24 }, (_unused, index) => index + 1);

/** How many ice rows a column may be covered in: fewer than all eight. */
const ROWS_COVERED_LIMIT = ICE_LANES.length;

/** One column of one draw: how many of the eight ice rows covered it. */
interface ColumnReading {
  seed: number;
  col: number;
  covered: number;
}

/** How many vehicles one lane carried on one draw. */
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

it("leaves no column covered in all eight ice rows, on every draw of the phases", async () => {
  const columns: ColumnReading[] = [];
  const lanes: LaneReading[] = [];

  for (const seed of SEEDS) {
    const laid = await layOutLevel(h, LEVEL, { seed });
    const rows = ICE_LANES.map((lane) => itemsInRow(laid.vehicles, lane.row));
    rows.forEach((carried, index) => {
      lanes.push({ seed, row: ICE_LANES[index].row, count: carried.length });
    });
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        seed,
        col,
        covered: rows.filter((carried) =>
          carried.some((vehicle) => coversTile(vehicle, col)),
        ).length,
      });
    }
  }
  captureStill(h, "scene");

  for (const lane of lanes) {
    assertGreaterThanOrEqual(
      lane.count,
      1,
      `seed ${lane.seed}, row ${lane.row}: a lane carries vehicles at all ` +
        "(specs/ice.md)",
    );
  }
  for (const reading of columns) {
    assertLessThan(
      reading.covered,
      ROWS_COVERED_LIMIT,
      `seed ${reading.seed}, column ${reading.col}: the ice rows covering it, ` +
        `of ${ROWS_COVERED_LIMIT}`,
    );
  }
});
