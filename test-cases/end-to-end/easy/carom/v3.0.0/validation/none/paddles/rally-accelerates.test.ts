// paddles/rally-accelerates — each paddle hit speeds the ball up a little.
//
// A REAL straight rally is played out — two still, centred paddles and a ball
// launched level down the middle, so every hit is a plain, spin-free centre
// contact — and the ball's speed after each successive hit is collected. The
// per-hit ratio must be the specified multiplier while the ball is below the
// ceiling, and the sequence must never decrease. The plateau AT the ceiling is
// the sibling `rally-caps` check.
//
// HOW LONG THE RALLY IS. Exactly the hits that happen below the ceiling, and no
// more: the length follows from `RALLY_LAUNCH_SPEED`, `SPEED_MULT` and
// `SPEED_CAP` rather than being picked, and every hit past it belongs to the
// sibling check.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { SPEED_CAP, SPEED_MULT } from "../constants";
import {
  arrangeRally,
  captureReplay,
  createHarness,
  driveRallySpeeds,
  RALLY_HITS_TO_CAP,
  type Harness,
} from "../harness";

/**
 * The hits the rally drives: every one the multiplier decides on its own.
 *
 * One short of the climb to the ceiling, so the last of them leaves the ball
 * still clear of `SPEED_CAP` and every ratio read below is one this item is
 * about. A hit past it is the sibling `rally-caps` check's subject rather than
 * this one's, and a rally that runs into the plateau costs legs of real physics
 * to decide nothing this check has not already decided.
 */
const HITS_BELOW_CAP = RALLY_HITS_TO_CAP - 1;
/**
 * One percent on the ratio, rounding room on `SPEED_MULT`, and half a unit per
 * second on a decrease.
 */
const RATIO_TOLERANCE = 0.01;
const DECREASE_TOLERANCE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("multiplies the ball's speed on every hit below the ceiling", async () => {
  await arrangeRally(harness);

  const speeds = await captureReplay(harness, "acceleration", () =>
    driveRallySpeeds(harness, HITS_BELOW_CAP),
  );

  assertGreaterThanOrEqual(speeds.length, HITS_BELOW_CAP);

  for (let i = 1; i < speeds.length; i += 1) {
    assertGreaterThanOrEqual(speeds[i], speeds[i - 1] - DECREASE_TOLERANCE);
    // Only the hits that had room to accelerate: at the ceiling the multiply is
    // clamped, which is the sibling check's subject rather than this one's.
    if (speeds[i - 1] < SPEED_CAP / SPEED_MULT - 1) {
      assertLessThanOrEqual(
        Math.abs(speeds[i] / speeds[i - 1] - SPEED_MULT),
        RATIO_TOLERANCE,
      );
    }
  }
});
