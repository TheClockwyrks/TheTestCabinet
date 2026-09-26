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
// — the distance is compared against the TABLE's figure, not against the
// build's reported one, so a build that is consistently wrong is still wrong.
//
// THE DIRECTION IS NOT READ HERE; `water/lane-directions` grades that. The
// distance is taken as an absolute value so a lane drifting the wrong way fails
// there and only there.
//
// THE LEVEL'S OWN FLOES ARE WHAT IS WATCHED, for the reason `midStraitFloe`
// gives: a lane's speed is a property of the level as it was laid out, and a
// floe taken from the middle of the strait cannot wrap inside the second being
// measured, so the displacement is travel rather than a jump.

import { afterEach, beforeEach, it } from "vitest";
import { laneSpeed, TILE, WATER_LANES } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  floeOf,
  laneAt,
  ticksFor,
  type Harness,
} from "../harness";
import { layOutLevel, midStraitFloe } from "./harness";

/** The level laid out: the table's figures are its level-1 ones. */
const LEVEL = 1;

/**
 * How far a reported speed may sit from the table's figure, in tiles a second.
 *
 * The closest pair of figures in the level-1 table are a tenth of a tile a
 * second apart (`3.2` and `3.3`, `3.3` and `3.4`, and so on), so a tenth of THAT
 * separation still names which lane's figure a build reached for while leaving a
 * build room to arrive at `3.3` by computing `3.3 * LEVEL_SPEED_STEP ^ 0` rather
 * than writing it down.
 */
const REPORTED_SPEED_TOLERANCE = 0.01;

/** The game time the ground covered is measured over, in seconds. */
const MEASURED_SECONDS = 1;

/**
 * How far the ground covered may sit from `speed * TILE`, as a fraction.
 *
 * The two per cent the item is stated at. On the slowest lane that is `1.92`
 * units out of `96`, and the nearest wrong figure a build could be running — the
 * `3.2` on row 6 — is `6.4` units away over the same second, so the bound
 * separates one lane's speed from the next figure in the table more than
 * three times over.
 */
const COVERED_TOLERANCE_FRACTION = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drifts each water lane at its level-1 table speed, in report and in ground covered", async () => {
  const laid = await layOutLevel(h, LEVEL);

  // What each lane says it drifts at.
  for (const lane of WATER_LANES) {
    const expected = laneSpeed(lane.row, LEVEL);
    const reported = laneAt(laid, lane.row).speed;
    assertLessThanOrEqual(
      Math.abs(reported - expected),
      REPORTED_SPEED_TOLERANCE,
      `row ${lane.row}: reported speed away from ${expected} tiles a second, ` +
        `was ${reported}`,
    );
  }

  // One floe per lane, followed by id across the second below.
  const followed = WATER_LANES.map((lane) => {
    const floe = midStraitFloe(laid, lane.row);
    return { row: lane.row, id: floe.id, x: floe.x };
  });

  const after = await captureReplay(h, "drift", async () => {
    await h.advance(ticksFor(MEASURED_SECONDS));
    return h.snapshot();
  });

  for (const start of followed) {
    const covered = Math.abs(floeOf(after, start.id).x - start.x);
    const expected = laneSpeed(start.row, LEVEL) * TILE * MEASURED_SECONDS;
    assertLessThanOrEqual(
      Math.abs(covered - expected),
      COVERED_TOLERANCE_FRACTION * expected,
      `row ${start.row}: the ground a floe covered in ${MEASURED_SECONDS} s ` +
        `away from ${expected} units, was ${covered}`,
    );
  }
});
