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
// ONE LEVEL, LAID OUT MANY TIMES. The condition is stated of the draw itself,
// so it holds of the band every layout of the level produces, and a reading of
// one layout is one sample of a rule stated of all of them. Each layout is read
// on its own and none may carry the bridge; no figure is gathered off the
// draws, because how the phases SPREAD is the specification's business rather
// than this point's.
//
// A LANE HAS TO CARRY SOMETHING for the count to mean anything: a band with no
// floes at all carries no column in eight rows, and would pass a reading that
// only counted. specs/water.md requires each lane to carry enough floes to reach
// both edges of the strait, so an empty lane fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { COLS, WATER_LANES } from "../constants";
import {
  captureStill,
  createHarness,
  itemCoversTile,
  type Harness,
} from "../harness";
import { floesAlong, layOutLevel } from "./harness";

/** The level laid out. The staggering rule holds at every level. */
const LEVEL = 1;

/**
 * How many times the level is laid out and read.
 *
 * The condition is stated of the DRAW, so it holds of every layout of the band,
 * and one layout is one sample of it. A build that draws its eight phases and
 * keeps whatever they come out as leaves a bridge on only a fraction of its
 * layouts, so a reading of a single layout returns a different verdict on the
 * same build from one run to the next. Reading many layouts is the same
 * requirement with power that does not turn on which sample came up, and it
 * costs a build that meets the condition nothing: such a build has no layout
 * that can fail.
 *
 * A HUNDRED AND TWENTY-EIGHT IS ENOUGH ON THIS BAND, AND THE FIGURE IS MEASURED.
 * The water lanes are broad: a raft lane covers three tiles in six or four in
 * seven and a pan lane one in three (specs/water.md), so a band whose phases
 * were drawn with no condition on them bridges a column on about one layout in
 * eighteen — 85 bridged layouts in 1500 laid out by a build whose rejection had
 * been taken out. Over 128 layouts such a build goes unseen about six runs in
 * ten thousand, which is what makes this reading a verdict rather than a sample.
 * The ice band is far sparser and cannot be read this way at any affordable
 * length; `ice/phases-staggered` says there what it can and cannot settle.
 */
const LAYOUTS = 128;

/** How many water rows a column may carry a floe in: fewer than all eight. */
const ROWS_CARRYING_LIMIT = WATER_LANES.length;

/** One column of the laid-out band: how many of the eight rows carried a floe. */
interface ColumnReading {
  col: number;
  carrying: number;
}

/** How many floes one lane carried. */
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

it("leaves no column carrying a floe in all eight water rows", async () => {
  for (let layout = 1; layout <= LAYOUTS; layout += 1) {
    const laid = await layOutLevel(h, LEVEL);
    const rows = WATER_LANES.map((lane) => floesAlong(laid, lane.row));

    const lanes: LaneReading[] = rows.map((carried, index) => ({
      row: WATER_LANES[index].row,
      count: carried.length,
    }));
    const columns: ColumnReading[] = [];
    for (let col = 0; col < COLS; col += 1) {
      columns.push({
        col,
        carrying: rows.filter((carried) =>
          carried.some((floe) => itemCoversTile(floe, col)),
        ).length,
      });
    }
    // The picture kept is the first layout, and any layout that breaks
    // the rule, so a failure below is the band the still shows.
    const broken =
      lanes.some((lane) => lane.count < 1) ||
      columns.some((reading) => reading.carrying >= ROWS_CARRYING_LIMIT);
    if (layout === 1 || broken) {
      captureStill(h, "scene");
    }

    for (const lane of lanes) {
      assertGreaterThanOrEqual(
        lane.count,
        1,
        `layout ${layout} of ${LAYOUTS}, row ${lane.row}: a lane carries ` +
          `floes at all (specs/water.md)`,
      );
    }
    for (const reading of columns) {
      assertLessThan(
        reading.carrying,
        ROWS_CARRYING_LIMIT,
        `layout ${layout} of ${LAYOUTS}, column ${reading.col}: the water ` +
          `rows carrying a floe over it, of ${ROWS_CARRYING_LIMIT}`,
      );
    }
  }
});
