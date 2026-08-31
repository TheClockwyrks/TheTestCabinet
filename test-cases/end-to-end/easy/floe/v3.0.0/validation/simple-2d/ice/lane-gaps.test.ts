// ice/lane-gaps — consecutive vehicles in a lane leave exactly the clear ice the
// lane table gives that row.
//
// specs/ice.md fixes both the figure and how it is measured: gap "is the whole
// tiles of clear ice a lane leaves between consecutive vehicles", and the
// population rule says "consecutive vehicles leave exactly the lane's gap in
// tiles of clear ice between one vehicle's right edge and the next vehicle's
// left edge". The eight figures are `8, 7, 7, 8, 7, 7, 8, 7` from row 11 down to
// row 18 — the three plow lanes leave `8` and the five two-tile lanes leave `7`.
//
// So the reading is `next.x - (vehicle.x + TILE * vehicle.len)` in tiles, taken
// over the vehicles of a row in order along it, and every one of those runs must
// be the row's gap. That is what makes the run of vehicle and gap uniform, which
// is the property `ice/lane-wraps` then requires to survive the edges.
//
// ONLY CONSECUTIVE PAIRS ARE MEASURED. The distance from a row's rightmost
// vehicle back round to its leftmost is not a run of clear ice on the strait,
// and `gapsBetween` leaves it out.
//
// A lane has to carry at least two vehicles for a run to exist at all, and
// specs/ice.md requires far more than two — "a lane always carries enough
// vehicles to reach both edges of the strait" — so a lane carrying one fails
// here rather than passing with nothing measured.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES, laneGap } from "../../src/constants";
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
 * How far a run of clear ice may sit from the table's figure, in TILES.
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

it("leaves each ice lane's stated gap of clear ice between consecutive vehicles", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  for (const lane of ICE_LANES) {
    const carried = itemsInRow(laid.vehicles, lane.row);
    assertGreaterThanOrEqual(
      carried.length,
      2,
      `row ${lane.row}: vehicles enough to leave a run of clear ice between ` +
        "two of them (specs/ice.md)",
    );
    const expected = laneGap(lane.row, LEVEL);
    for (const [index, run] of gapsBetween(carried).entries()) {
      assertLessThanOrEqual(
        Math.abs(run - expected),
        GAP_TOLERANCE_TILES,
        `row ${lane.row}, between vehicles ${index} and ${index + 1}: the ` +
          `clear ice away from ${expected} tiles, was ${run}`,
      );
    }
  }
});
