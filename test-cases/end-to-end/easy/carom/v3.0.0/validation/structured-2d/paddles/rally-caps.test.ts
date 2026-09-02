// paddles/rally-caps — the per-hit speed-up stops at the ceiling.
//
// The same REAL rally as `rally-accelerates`, run long enough to climb to the
// ceiling: however many hits it runs, the ball plateaus at the cap and never
// exceeds it.
//
// HOW LONG THE RALLY IS. The climb IS this check's subject, so the length is not
// a free choice: it is the number of hits `SPEED_MULT` needs to carry
// `RALLY_LAUNCH_SPEED` to `SPEED_CAP`, plus a couple more spent sitting on the
// ceiling, and it is computed from those three figures rather than picked.

import { afterEach, beforeEach, it } from "vitest";
import { SPEED_CAP, SPEED_MULT } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeRally,
  captureReplay,
  createHarness,
  driveRallySpeeds,
  RALLY_LAUNCH_SPEED,
  type Harness,
} from "../harness";

/**
 * The hits it takes to carry `RALLY_LAUNCH_SPEED` to `SPEED_CAP`, multiplying by
 * `SPEED_MULT` each time. The rally must sustain at least this many for the
 * plateau below to be a plateau rather than a rally still climbing.
 */
const HITS_TO_CAP = Math.ceil(
  Math.log(SPEED_CAP / RALLY_LAUNCH_SPEED) / Math.log(SPEED_MULT),
);
/** Hits spent ON the ceiling, so the plateau is read more than once. */
const PLATEAU_HITS = 2;
/** "Never exceeds it": a float margin on the peak, in units per second. */
const OVERSHOOT_TOLERANCE = 1e-6;
/** The review item's margin on the plateau: one percent of SPEED_CAP. */
const PLATEAU_TOLERANCE = SPEED_CAP * 0.01;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("plateaus at the speed ceiling and never exceeds it", async () => {
  await arrangeRally(harness);

  const speeds = await captureReplay(harness, "ceiling", () =>
    driveRallySpeeds(harness, HITS_TO_CAP + PLATEAU_HITS),
  );

  assertGreaterThanOrEqual(speeds.length, HITS_TO_CAP + PLATEAU_HITS);
  assertLessThanOrEqual(Math.max(...speeds), SPEED_CAP + OVERSHOOT_TOLERANCE);
  assertLessThanOrEqual(
    Math.abs(speeds[speeds.length - 1] - SPEED_CAP),
    PLATEAU_TOLERANCE,
  );
});
