// ice/lane-kinds — every vehicle in a lane is the one kind that lane carries.
//
// specs/ice.md's lane table gives each of the eight rows one vehicle kind, and
// the population rule states it directly: "Every vehicle in a lane is the lane's
// own kind." So a freshly laid-out level is read row by row and every vehicle on
// the row is required to report that row's kind.
//
// A LANE HAS TO CARRY SOMETHING for the reading to mean anything, and
// specs/ice.md requires that too — "a lane always carries enough vehicles to
// reach both edges of the strait" — so an empty lane fails here rather than
// passing vacuously.
//
// The kinds are what tell the eight lanes apart: three rows carry a `plow`,
// three a `car` and two a `dogsled`, in that arrangement and no other, so a
// build that gave every lane the same vehicle fails on five rows and a build
// that shifted the table by one fails on six.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  itemsInRow,
  type Harness,
} from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. The table this reads is the same at every level. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills each ice lane with the vehicle kind the lane table gives its row", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  for (const lane of ICE_LANES) {
    const carried = itemsInRow(laid.vehicles, lane.row);
    assertGreaterThanOrEqual(
      carried.length,
      1,
      `row ${lane.row}: a lane carries vehicles at all (specs/ice.md)`,
    );
    for (const [index, vehicle] of carried.entries()) {
      assertEqual(
        vehicle.kind,
        lane.kind,
        `row ${lane.row}, vehicle ${index} at x ${vehicle.x}: kind`,
      );
    }
  }
});
