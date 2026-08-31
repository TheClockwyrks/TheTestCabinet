// water/lane-speeds — each water lane drifts at the speed its row of the lane
// table gives it, and its floes really cover that ground.
//
// specs/water.md states speed "in tiles per second at level 1" and fixes the
// eight figures — `3.3, 3.5, 4.2, 3.6, 3.2, 3.8, 3.4, 3.0` from row 2 down to
// row 9 — and then fixes what a speed MEANS: "A lane at speed `s` and direction
// `d` moves every one of its floes by `d * s * TILE` units per second of game
// time."
//
// TWO READINGS, ONE REQUIREMENT. The number each lane reports, and the ground a
// floe actually covers in a second. They are two halves of the same rule and
// they fail independently: a build can report `4.2` and drift at `1.0`, or drift
// correctly and report nothing like it. Neither reading is taken from the other
// — the distance is compared against the TABLE's figure, not against the build's
// reported one, so a build that is consistently wrong is still wrong.
//
// THE DIRECTION is not read here; `water/lane-directions` grades that. The
// distance is taken as an absolute value so a lane drifting the wrong way fails
// there and only there.
//
// THE LEVEL'S OWN WATER IS WHAT IS WATCHED, for the reason `midStraitFloe`
// gives: a lane's speed is a property of the level as it was laid out, and a
// floe taken from the middle of the strait cannot wrap inside the second being
// measured, so the displacement is travel rather than a jump.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertLessThanOrEqual,
} from "../assert";
import { TILE, WATER_LANES, laneSpeed } from "../constants";
import {
  captureReplay,
  createHarness,
  laneAt,
  requireItem,
  ticksFor,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitFloe } from "./harness";

/** The level laid out: the table's figures are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a reported speed may sit from the table's figure, in tiles a second.
 *
 * The eight level-1 figures are a tenth of a tile a second apart at their
 * closest (`3.3` and `3.4`, on rows 2 and 8), so a hundredth still names which
 * lane's figure a build reached for while leaving a build room to arrive at
 * `3.3` by computing `3.3 * LEVEL_SPEED_STEP ^ 0` rather than writing it down.
 */
const REPORTED_SPEED_TOLERANCE = 0.01;

/** The game time the ground covered is measured over, in seconds. */
const MEASURED_SECONDS = 1;

/**
 * How far the ground covered may sit from `speed * TILE`, as a fraction.
 *
 * The two per cent the item is stated at. On the slowest lane that is `1.92`
 * units out of `96`, and the nearest wrong figure a build could be drifting at —
 * the `3.2` on row 6 — is `6.4` units away over the same second, so the bound
 * separates one lane's speed from its neighbour's more than three times over.
 */
const COVERED_TOLERANCE_FRACTION = 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("drifts each water lane at its level-1 table speed, in report and in ground covered", async () => {
  const laid = await layOutLevel(harness, LEVEL);

  // What each lane says it drifts at.
  for (const lane of WATER_LANES) {
    const reported = laneAt(laid, lane.row);
    assertDefined(reported, `row ${lane.row}: a water lane on that row`);
    if (reported === undefined) continue;
    assertLessThanOrEqual(
      Math.abs(reported.speed - laneSpeed(lane.row, LEVEL)),
      REPORTED_SPEED_TOLERANCE,
      `row ${lane.row}: reported speed away from ` +
        `${laneSpeed(lane.row, LEVEL)} tiles a second, was ${reported.speed}`,
    );
  }

  // One floe per lane, followed by id across the second below.
  //
  // THE START IS READ FRESH, immediately before the drive, rather than off
  // `laid`: `layOutLevel` runs one drawn frame after taking that snapshot, and
  // the tick of lane motion inside it is drift the second below never drove.
  // Charging it to the measurement would spend `0.83%` of the `2%` this check
  // allows on an offset that has nothing to do with the build.
  const before = await harness.snapshot();
  const followed = new Map<number, { id: number; x: number }>();
  for (const lane of WATER_LANES) {
    const floe = midStraitFloe(before, lane.row);
    assertDefined(
      floe,
      `row ${lane.row}: a floe to follow (specs/water.md: a lane always ` +
        `carries enough floes to reach both edges of the strait)`,
    );
    if (floe !== undefined) {
      followed.set(lane.row, { id: floe.id, x: floe.x });
    }
  }

  const after = await captureReplay(harness, "drift", async () => {
    await harness.advance(ticksFor(MEASURED_SECONDS));
    return harness.snapshot();
  });

  for (const lane of WATER_LANES) {
    const start = followed.get(lane.row);
    if (start === undefined) continue;
    const moved = requireItem(
      after,
      start.id,
      `following the floe on row ${lane.row} for ${MEASURED_SECONDS} s`,
    );
    const expected = laneSpeed(lane.row, LEVEL) * TILE * MEASURED_SECONDS;
    assertLessThanOrEqual(
      Math.abs(Math.abs(moved.x - start.x) - expected),
      COVERED_TOLERANCE_FRACTION * expected,
      `row ${lane.row}: the ground a floe covered in ${MEASURED_SECONDS} s ` +
        `away from ${expected} units, was ${Math.abs(moved.x - start.x)}`,
    );
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
