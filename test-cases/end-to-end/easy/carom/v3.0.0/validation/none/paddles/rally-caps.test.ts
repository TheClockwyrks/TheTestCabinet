// paddles/rally-caps — the per-hit speed-up stops at the ceiling.
//
// The same REAL rally as `rally-accelerates` — an emptied field, two still,
// centred paddles left with the player, and a ball launched level down the
// middle — run long enough to climb to the ceiling: however many hits it runs,
// the ball plateaus at the cap and never exceeds it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { SPEED_CAP } from "../constants";
import {
  arrangeRally,
  captureReplay,
  createHarness,
  driveRallySpeeds,
  type Harness,
} from "../harness";

/** Enough hits, from the 500 px/s launch, to reach the ceiling and sit on it. */
const MIN_HITS = 12;
/** Float margins: on the peak, and on the settled final speed. */
const OVERSHOOT_TOLERANCE = 1;
const PLATEAU_TOLERANCE = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("plateaus at the speed ceiling and never exceeds it", async () => {
  await arrangeRally(harness);

  const speeds = await captureReplay(harness, "ceiling", () =>
    driveRallySpeeds(harness),
  );

  assertGreaterThanOrEqual(speeds.length, MIN_HITS);
  assertLessThanOrEqual(Math.max(...speeds), SPEED_CAP + OVERSHOOT_TOLERANCE);
  assertLessThanOrEqual(
    Math.abs(speeds[speeds.length - 1] - SPEED_CAP),
    PLATEAU_TOLERANCE,
  );
});
