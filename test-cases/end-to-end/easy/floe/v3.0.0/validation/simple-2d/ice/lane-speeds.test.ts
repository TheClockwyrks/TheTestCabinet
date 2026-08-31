// ice/lane-speeds — each ice lane runs at the speed its row of the lane table
// gives it, and its vehicles really cover that ground.
//
// specs/ice.md states speed "in tiles per second at level 1" and fixes the eight
// figures — `1.7, 2.1, 2.5, 1.6, 2.0, 2.3, 1.5, 1.8` from row 11 down to row 18
// — and then fixes what a speed MEANS: "A lane at speed `s` and direction `d`
// moves every one of its vehicles by `d * s * TILE` units per second of game
// time."
//
// TWO READINGS, ONE REQUIREMENT. The number each lane reports, and the ground a
// vehicle actually covers in a second. They are two halves of the same rule and
// they fail independently: a build can report `2.5` and drift at `1.0`, or move
// correctly and report nothing like it. Neither reading is taken from the other
// — the distance is compared against the TABLE's figure, not against the
// build's reported one, so a build that is consistently wrong is still wrong.
//
// THE DIRECTION IS NOT READ HERE; `ice/lane-directions` grades that. The
// distance is taken as an absolute value so a lane running the wrong way fails
// there and only there.
//
// THE LEVEL'S OWN TRAFFIC IS WHAT IS WATCHED, for the reason `midStraitVehicle`
// gives: a lane's speed is a property of the level as it was laid out, and a
// vehicle taken from the middle of the strait cannot wrap inside the second
// being measured, so the displacement is travel rather than a jump.

import { afterEach, beforeEach, it } from "vitest";
import { ICE_LANES, laneSpeed, TILE } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  laneAt,
  ticksFor,
  vehicleOf,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitVehicle } from "./harness";

/** The level laid out: the table's figures are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a reported speed may sit from the table's figure, in tiles a second.
 *
 * The two closest figures in the level-1 table are `1.5` and `1.6`, a tenth of a
 * tile a second apart, so a tenth of THAT separation still names which lane's
 * figure a build reached for while leaving a build room to arrive at `1.7` by
 * computing `1.7 * LEVEL_SPEED_STEP ^ 0` rather than writing it down.
 */
const REPORTED_SPEED_TOLERANCE = 0.01;

/** The game time the ground covered is measured over, in seconds. */
const MEASURED_SECONDS = 1;

/**
 * How far the ground covered may sit from `speed * TILE`, as a fraction.
 *
 * The two per cent the item is stated at. On the slowest lane that is `0.96`
 * units out of `48`, and the nearest wrong figure a build could be running —
 * the `1.6` on row 14 — is `3.2` units away over the same second, so the bound
 * separates one lane's speed from its neighbour's more than three times over.
 */
const COVERED_TOLERANCE_FRACTION = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs each ice lane at its level-1 table speed, in report and in ground covered", async () => {
  const laid = await layOutLevel(h, LEVEL);

  // What each lane says it runs at.
  for (const lane of ICE_LANES) {
    const expected = laneSpeed(lane.row, LEVEL);
    const reported = laneAt(laid, lane.row).speed;
    assertLessThanOrEqual(
      Math.abs(reported - expected),
      REPORTED_SPEED_TOLERANCE,
      `row ${lane.row}: reported speed away from ${expected} tiles a second, ` +
        `was ${reported}`,
    );
  }

  // One vehicle per lane, followed by id across the second below.
  const followed = ICE_LANES.map((lane) => {
    const vehicle = midStraitVehicle(laid, lane.row);
    return { row: lane.row, id: vehicle.id, x: vehicle.x };
  });

  const after = await captureReplay(h, "slide", async () => {
    await h.advance(ticksFor(MEASURED_SECONDS));
    return h.snapshot();
  });

  for (const start of followed) {
    const covered = Math.abs(vehicleOf(after, start.id).x - start.x);
    const expected = laneSpeed(start.row, LEVEL) * TILE * MEASURED_SECONDS;
    assertLessThanOrEqual(
      Math.abs(covered - expected),
      COVERED_TOLERANCE_FRACTION * expected,
      `row ${start.row}: the ground a vehicle covered in ` +
        `${MEASURED_SECONDS} s away from ${expected} units, was ${covered}`,
    );
  }
});
