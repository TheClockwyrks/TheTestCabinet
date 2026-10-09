// gameplay/countdown-length — the pre-serve countdown lasts the specified hold.
//
// The match is started FROM THE TITLE with menu keys, and the hold is never
// touched: `setBallHoldTimer` and `spawnBall` both write the very number this
// check is timing, so a scenario that posed either would be measuring the case's
// own figure rather than the build's. Confirming the entry the player takes is
// what leaves the whole hold — its length and its running out — to the build.
//
// AND IT IS WHY THE FIELD IS NOT ISOLATED HERE. Clearing the field and spawning
// the ball back is how every other scenario in this category poses its world, but
// `spawnBall` restarts the hold, and the frames counted below run from the menu
// confirm. So the match keeps the world the build's own match start put on it;
// nothing on that field can reach the reading, which is a count of frames to the
// launch.
//
// From there the real simulation is stepped ONE FRAME at a time until the ball
// serves. At the harness's 120 Hz clock the hold is a whole number of frames, so
// the count is the duration. Each update reads input first and then advances
// the screen it left (specs/ui.md), so the frame that confirmed the menu is
// also the first countdown frame, and the serve lands on the frame on which
// `holdTimer - dt <= 0` first holds: HOLD_TIME of frames counting that one.

import { afterEach, beforeEach, it } from "vitest";
import { HOLD_TIME } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  startWithKeys,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The hold, in frames of the harness's clock. */
const HOLD_TICKS = HOLD_TIME * TICK_HZ;
/**
 * The review item's margin: one frame either side, which covers the confirm
 * frame counting or not and the float rounding of `HOLD_TIME - n * dt`.
 */
const TOLERANCE_TICKS = 1;
/**
 * Frames of the served flight recorded after the launch.
 *
 * The sweep stops on the frame the screen turns over, which is what the hold's
 * length is measured against and so cannot move. The review item promises "the
 * pre-serve countdown running out", and a countdown running out ends in a serve —
 * so the ball leaving is recorded too, after every reading is taken.
 */
const FLIGHT_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("holds the ball for the pre-serve countdown, then serves", async () => {
  await startWithKeys(harness, "versus");

  const start = harness.snapshot();
  assertEqual(start.screen, "countdown");
  assertEqual(ball0(start).held, true);

  // The hold itself, from the frame after the menu confirm to the launch: the
  // countdown running out is the whole of what this point is about.
  const served = await captureReplay(harness, "countdown", async () => {
    const launched = await harness.until((s) => s.screen === "playing", {
      maxFrames: 240,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);
    return launched;
  });

  assertEqual(served.hit, true);
  assertLessThanOrEqual(Math.abs(served.frames - HOLD_TICKS), TOLERANCE_TICKS);
  assertGreaterThan(ball0(served.snapshot).speed, 1);
});
