// water/lane-gaps — consecutive floes in a lane leave exactly the open water the
// lane table gives that row.
//
// specs/water.md fixes both the figure and how it is measured: gap "is the whole
// tiles of open water a lane leaves between consecutive floes", and the
// population rule says "consecutive floes leave exactly the lane's gap in tiles
// of open water between one floe's right edge and the next floe's left edge".
// The eight figures are `3, 3, 3, 2, 3, 3, 2, 3` from row 2 down to row 9 — the
// two `pan` lanes leave `2` and the six raft lanes `3`.
//
// So the reading is `next.x - (floe.x + TILE * floe.len)` in tiles, taken over
// the floes of a row in order along it, and every one of those runs must be the
// row's gap. That is what makes the run of floe and open water uniform, which is
// the property `water/lane-wraps` then requires to survive the edges.
//
// ONLY CONSECUTIVE PAIRS ARE MEASURED. The distance from a row's rightmost floe
// back round to its leftmost is not a run of open water on the strait, and
// `gapsBetween` leaves it out.
//
// A lane has to carry at least two floes for a run to exist at all, and
// specs/water.md requires far more than two — "a lane always carries enough
// floes to reach both edges of the strait" — so a lane carrying one fails here
// rather than passing with nothing measured.

import { afterEach, beforeEach, it } from "vitest";
import { laneGap, WATER_LANES } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  gapsBetween,
  itemsInRow,
  type Harness,
} from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out: the table's gaps are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a run of open water may sit from the table's figure, in TILES.
 *
 * The tenth of a tile the item is stated at. A lane's gap is a WHOLE number of
 * tiles, so the nearest wrong figure a build could be spacing at is a whole tile
 * away, which this bound is a tenth of.
 */
const GAP_TOLERANCE_TILES = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves each water lane's stated gap of open water between consecutive floes", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  for (const lane of WATER_LANES) {
    const carried = itemsInRow(laid.floes, lane.row);
    assertGreaterThanOrEqual(
      carried.length,
      2,
      `row ${lane.row}: floes enough to leave a run of open water between two ` +
        "of them (specs/water.md)",
    );
    const expected = laneGap(lane.row, LEVEL);
    for (const [index, run] of gapsBetween(carried).entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE_TILES,
        `row ${lane.row}, between floes ${index} and ${index + 1}: the open ` +
          `water away from ${expected} tiles, was ${run}`,
      );
    }
  }
});
