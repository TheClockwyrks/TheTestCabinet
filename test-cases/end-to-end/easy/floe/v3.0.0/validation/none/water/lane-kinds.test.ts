// water/lane-kinds — every floe in a lane is the one kind that lane carries.
//
// specs/water.md's lane table gives each of the eight rows one floe kind, and
// the population rule states it directly: "Every floe in a lane is the lane's
// own kind." So a freshly laid-out level is read row by row and every floe on
// the row is required to report that row's kind.
//
// A LANE HAS TO CARRY SOMETHING for the reading to mean anything, and
// specs/water.md requires that too — "a lane always carries enough floes to
// reach both edges of the strait" — so an empty lane fails here rather than
// passing vacuously.
//
// The kinds are what tell the eight lanes apart: three rows carry a `raft3`,
// three a `raft4` and two a `pan`, in that arrangement and no other, so a build
// that gave every lane the same floe fails on five rows and a build that shifted
// the table by one fails on six.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { WATER_LANES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { floesAlong, layOutLevel } from "./harness";

/** The level laid out. The table this reads is the same at every level. */
const LEVEL = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("fills each water lane with the floe kind the lane table gives its row", async () => {
  const laid = await layOutLevel(harness, LEVEL);
  await captureStill(harness, "scene");

  for (const lane of WATER_LANES) {
    const carried = floesAlong(laid, lane.row);
    assertGreaterThanOrEqual(
      carried.length,
      1,
      `row ${lane.row}: a lane carries floes at all (specs/water.md)`,
    );
    for (const [index, floe] of carried.entries()) {
      assertEqual(
        floe.kind,
        lane.kind,
        `row ${lane.row}, floe ${index} at x ${floe.x}: kind`,
      );
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
