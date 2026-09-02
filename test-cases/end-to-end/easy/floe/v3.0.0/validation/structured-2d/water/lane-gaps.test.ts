// Floe — water/lane-gaps: consecutive floes in a lane leave exactly the open
// water the lane table gives that row.
//
// specs/water.md fixes both the figure and how it is measured: gap "is the whole
// tiles of open water a lane leaves between consecutive floes", and the
// population rule says "consecutive floes leave exactly the lane's gap in tiles
// of open water between one floe's right edge and the next floe's left edge".
// The eight figures are `3, 3, 3, 2, 3, 3, 2, 3` from row 2 down to row 9 — the
// six raft lanes leave `3` and the two pan lanes leave `2`.
//
// So the reading is `next.x - (floe.x + TILE * floe.len)` taken over the floes
// of a row in order along it, and every one of those runs must be the row's gap.
// That is what makes the run of floe and open water uniform, which is the
// property `water/lane-wraps` then requires to survive the edges.
//
// ONLY CONSECUTIVE PAIRS ARE MEASURED. The distance from a row's rightmost floe
// back round to its leftmost is not a run of open water on the strait, and
// `openWaterRuns` leaves it out.
//
// A lane has to carry at least two floes for a run to exist at all, and
// specs/water.md requires far more than two — "a lane always carries enough
// floes to reach both edges of the strait" — so a lane carrying one fails here
// rather than passing with nothing measured.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { TILE, WATER_LANES, laneGap } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { floesAlong, layOutLevel, openWaterRuns } from "./harness";

/** The level laid out: the table's gaps are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a run of open water may sit from the table's figure, in stage units.
 *
 * The tenth of a tile the item is stated at, `0.1 * TILE`. A lane's gap is a
 * WHOLE number of tiles, so the nearest wrong figure a build could be spacing at
 * is a whole tile — `32` units — away, which this bound is a tenth of.
 */
const GAP_TOLERANCE = 0.1 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves each water lane's stated gap of open water between consecutive floes", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  for (const lane of WATER_LANES) {
    assertGreaterThanOrEqual(
      floesAlong(laid, lane.row).length,
      2,
      `row ${lane.row}: floes enough to leave a run of open water between two ` +
        `of them (specs/water.md)`,
    );
    const tiles = laneGap(lane.row, LEVEL);
    const expected = tiles * TILE;
    for (const [index, run] of openWaterRuns(laid, lane.row).entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE,
        `row ${lane.row}, between floes ${index} and ${index + 1}: the open ` +
          `water away from ${expected} units (${tiles} tiles), was ${run}`,
      );
    }
  }
});
