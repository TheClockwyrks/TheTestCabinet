// Floe — ice/lane-lengths: each vehicle kind spans the number of tiles its own
// row of the vehicle table gives it.
//
// specs/ice.md: a `plow` is `3` tiles, a `dogsled` `2` and a `car` `2`, and
// `ITEM_LEN` "names the length in tiles of every lane item". The length is not
// decoration: the covering rule is written on it — an item occupies
// `[x, x + TILE * len)` — so every refusal, every crush and every gap in this
// group is measured against the span this check decides.
//
// It reads every vehicle on a freshly laid-out level rather than one of each
// kind, so a build that got a plow right in one lane and wrong in another fails
// with the row named. The three kinds are each required to appear, because the
// table puts all three on the eight lanes and a reading that saw only cars would
// have graded a third of the requirement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { ICE_LANES, ITEM_LEN } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type VehicleKind,
} from "../harness";
import { layOutLevel } from "./harness";

/** The level laid out. The kinds' lengths are the same at every level. */
const LEVEL = 1;

/** The three kinds the ice band carries (specs/ice.md). */
const VEHICLE_KINDS: readonly VehicleKind[] = ["plow", "dogsled", "car"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spans a plow over 3 tiles and a dogsled and a car over 2, on every lane", async () => {
  const laid = await layOutLevel(h, LEVEL);
  captureStill(h, "scene");

  assertGreaterThanOrEqual(
    laid.vehicles.length,
    ICE_LANES.length,
    "the eight ice lanes carry vehicles at all (specs/ice.md)",
  );

  for (const vehicle of laid.vehicles) {
    assertContains(
      VEHICLE_KINDS,
      vehicle.kind,
      `row ${vehicle.row} at x ${vehicle.x}: the ice band carries only plows, ` +
        `dogsleds and cars (specs/ice.md)`,
    );
    assertEqual(
      vehicle.len,
      ITEM_LEN[vehicle.kind],
      `row ${vehicle.row}, ${vehicle.kind} at x ${vehicle.x}: len in tiles`,
    );
  }

  // All three kinds are on the table, so all three are on the strait: a level
  // that laid down only one kind would otherwise have graded only that one.
  const drawn = new Set(laid.vehicles.map((vehicle) => vehicle.kind));
  for (const kind of VEHICLE_KINDS) {
    assertContains(
      [...drawn],
      kind,
      `the lane table puts a ${kind} on the ice band (specs/ice.md)`,
    );
  }
});
