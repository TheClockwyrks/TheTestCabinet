// paddles/rally-caps — the per-hit speed-up stops at the ceiling.
//
// The same REAL rally as `rally-accelerates`, run long enough to climb to the
// ceiling: however many hits it runs, the ball plateaus at the cap and never
// exceeds it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { SPEED_CAP } from "../../src/constants";
import {
  arrangeRally,
  captureReplay,
  createHarness,
  driveRallySpeeds,
  type Harness,
} from "../harness";

/** Enough hits, from the 500 px/s launch, to reach the ceiling and sit on it. */
const MIN_HITS = 12;
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
    driveRallySpeeds(harness),
  );

  expect(speeds.length).toBeGreaterThanOrEqual(MIN_HITS);
  expect(Math.max(...speeds)).toBeLessThanOrEqual(
    SPEED_CAP + OVERSHOOT_TOLERANCE,
  );
  expect(Math.abs(speeds[speeds.length - 1] - SPEED_CAP)).toBeLessThanOrEqual(
    PLATEAU_TOLERANCE,
  );
});
