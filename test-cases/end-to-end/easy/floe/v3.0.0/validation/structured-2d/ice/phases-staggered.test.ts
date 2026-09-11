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
// ONE LEVEL, LAID OUT MANY TIMES — AND WHAT THAT DOES AND DOES NOT SETTLE. The
// condition is stated of the draw itself, so it holds of the band every layout
// of the level produces, and a reading of one layout is one sample of a rule
// stated of all of them. Each layout is read on its own and none may carry the
// wall. On THIS band the samples do not add up to a verdict — the ice lanes are
// sparse enough that a band drawn with no condition on it walls a column only
// rarely — so the note on `LAYOUTS` below sets out what a run of this point is
// worth and what it is not. No figure is gathered off the draws, because how
// the phases SPREAD is the specification's business rather than this point's.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// vehicles at all covers no column in eight rows, and would pass a reading that
// only counted. specs/ice.md requires each lane to carry enough vehicles to
// reach both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { COLS, ICE_LANES } from "../constants";
import {
  captureStill,
  createHarness,
  itemCoversTile,
  type Harness,
} from "../harness";
import { layOutLevel, vehiclesAlong } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/**
 * How many times the level is laid out and read.
 *
 * The condition is stated of the DRAW, so it holds of every layout of the band,
 * and one layout is one sample of it. Reading many is the same requirement over
 * more samples, and it costs a build that meets the condition nothing: such a
 * build has no layout that can fail.
 *
 * WHAT A HUNDRED AND TWENTY-EIGHT LAYOUTS BUY ON THIS BAND, SAID PLAINLY. The
 * ice lanes are sparse: a plow lane covers three tiles in every eleven and a car
 * or dogsled lane two in every nine (specs/ice.md), so a band whose phases were
 * drawn with no condition on them walls one of the forty columns on about four
 * layouts in ten thousand — `40 * (3/11)^3 * (2/9)^5` — and exactly one wall
 * turned up in 5500 layouts laid out by a build whose rejection had been taken
 * out, which is what that arithmetic predicts. At 128 layouts this reading
 * therefore SAMPLES the condition rather than deciding it: it catches such a
 * build about one run in twenty, and its silence is not a verdict.
 *
 * WHY IT IS NOT SIMPLY RAISED. Deciding the rule would take some seven thousand
 * layouts. The TIME is affordable — a layout costs about 10 ms in process — but
 * the MEMORY is not: laying one out leaves about a third of a megabyte behind
 * that is never given back, evenly and without let-up (measured on one drive:
 * 346 MB at 250 layouts, 511 MB at 750, 792 MB at 1500). Seven thousand is a
 * couple of gigabytes in one worker. What is left behind is on the far side of
 * the debug surface — the build's own, or the engine's — because the reading
 * this file makes costs nothing measurable on its own, so a point drawn out that
 * far would pass a tidy build and run a leaky one out of memory, which arrives
 * as an assertion failure rather than as what it is. Where a band's phases fell
 * is what this point is about, and it must not come to rest on how the build
 * spends memory.
 *
 * WHAT THIS POINT DECIDES, THEN, is the other reading below it: that each of the
 * eight lanes carries vehicles at all, which the first layout settles outright.
 * The remaining 127 are the wall reading's, and they buy it the one run in
 * twenty above rather than a verdict — worth having, because a wall it does see
 * is a real failure and a build that meets the condition pays nothing for the
 * looking, but not to be read as a clean bill. The water band is where this same
 * rule CAN be decided — its lanes cover between a third and four sevenths of
 * their rows — so `water/phases-staggered` reads it with power and says so
 * there.
 */
const LAYOUTS = 128;

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
  h.dispose();
});

it("leaves no column covered in all eight ice rows", async () => {
  for (let layout = 1; layout <= LAYOUTS; layout += 1) {
    const laid = await layOutLevel(h, LEVEL);
    const rows = ICE_LANES.map((lane) => vehiclesAlong(laid, lane.row));

    const lanes: LaneReading[] = rows.map((carried, index) => ({
      row: ICE_LANES[index].row,
      count: carried.length,
    }));
    const columns: ColumnReading[] = [];
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        col,
        covered: rows.filter((carried) =>
          carried.some((vehicle) => itemCoversTile(vehicle, col)),
        ).length,
      });
    }
    // The picture kept is the first layout, and any layout that breaks
    // the rule, so a failure below is the band the still shows.
    const broken =
      lanes.some((lane) => lane.count < 1) ||
      columns.some((reading) => reading.covered >= ROWS_COVERED_LIMIT);
    if (layout === 1 || broken) {
      captureStill(h, "scene");
    }

    for (const lane of lanes) {
      assertGreaterThanOrEqual(
        lane.count,
        1,
        `layout ${layout} of ${LAYOUTS}, row ${lane.row}: a lane carries ` +
          `vehicles at all (specs/ice.md)`,
      );
    }
    for (const reading of columns) {
      assertLessThan(
        reading.covered,
        ROWS_COVERED_LIMIT,
        `layout ${layout} of ${LAYOUTS}, column ${reading.col}: the ice ` +
          `rows covering it, of ${ROWS_COVERED_LIMIT}`,
      );
    }
  }
});
