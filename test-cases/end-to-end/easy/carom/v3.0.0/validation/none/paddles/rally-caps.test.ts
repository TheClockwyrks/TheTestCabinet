// paddles/rally-caps — the per-hit speed-up stops at the ceiling.
//
// The same REAL rally as `rally-accelerates` — an emptied field, two still,
// centred paddles left with the player, and a ball launched level down the
// middle — run long enough to climb to the ceiling: however many hits it runs,
// the ball plateaus at the cap and never exceeds it.
//
// HOW LONG THE RALLY IS. The climb IS this check's subject, so the length is not
// a free choice: it is the number of hits `SPEED_MULT` needs to carry
// `RALLY_LAUNCH_SPEED` to `SPEED_CAP`, plus a couple more spent sitting on the
// ceiling. It follows from those three figures rather than being picked.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { SPEED_CAP } from "../constants";
import {
  arrangeRally,
  captureReplay,
  createHarness,
  driveRallySpeeds,
  RALLY_HITS_TO_CAP,
  type Harness,
} from "../harness";

/** Hits spent ON the ceiling, so the plateau is read more than once. */
const PLATEAU_HITS = 2;
/**
 * The whole rally: the climb to the ceiling, and the hits spent sitting on it.
 *
 * The rally must sustain all of them for the plateau below to be a plateau
 * rather than a rally still climbing.
 */
const RALLY_HITS = RALLY_HITS_TO_CAP + PLATEAU_HITS;
/** Float margins: on the peak, and on the settled final speed. */
const OVERSHOOT_TOLERANCE = 1;
const PLATEAU_TOLERANCE = 1;

/**
 * The hits at the END of the rally kept as the review item's replay.
 *
 * A recorder armed over a section is charged for every frame the section drives,
 * and the whole climb is thousands of them; what a reviewer watches to see the
 * plateau is the rally once it is ON the ceiling, which is where these are. They
 * are frames of the same drive the assertions below read.
 */
const RECORDED_HITS = 3;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("plateaus at the speed ceiling and never exceeds it", async () => {
  await arrangeRally(harness);

  const climb = await driveRallySpeeds(harness, RALLY_HITS - RECORDED_HITS);
  const onTheCeiling = await captureReplay(harness, "ceiling", () =>
    driveRallySpeeds(harness, RECORDED_HITS),
  );
  const speeds = [...climb, ...onTheCeiling];

  assertGreaterThanOrEqual(speeds.length, RALLY_HITS);
  assertLessThanOrEqual(Math.max(...speeds), SPEED_CAP + OVERSHOOT_TOLERANCE);
  assertLessThanOrEqual(
    Math.abs(speeds[speeds.length - 1] - SPEED_CAP),
    PLATEAU_TOLERANCE,
  );
});
