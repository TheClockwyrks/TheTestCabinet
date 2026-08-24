// gameplay/countdown-length — the pre-serve countdown lasts the specified hold.
//
// The match is started FROM THE TITLE with menu keys, not through the surface's
// `startMatch`: the specification has that operation set the hold itself, so a
// check that used it would be reading a pose the surface had just made rather
// than the duration the build's own match start runs. Confirming the entry the
// player takes is what makes the duration the build's.
//
// From there the real simulation is stepped ONE FRAME at a time until the ball
// serves. specs/balls.md: every countdown frame subtracts `dt` from
// `holdTimer`, and the ball is served on the first frame the result is `<= 0`.
// At the harness's 120 Hz clock `HOLD_TIME` is 120 frames, and the frame that
// delivers the confirm already counts: the match starts and its countdown
// advances on the same update. One frame either side is the room allowed, for
// that frame and for the rounding of 120 subtractions of a hundred-and-twentieth.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { HOLD_TIME } from "../constants";
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
/** One frame either side: the confirm's own frame, and the rounding of the count. */
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

afterEach(async () => {
  await harness.dispose();
});

it("holds the ball for the pre-serve countdown, then serves", async () => {
  await startWithKeys(harness, "versus");

  const start = await harness.snapshot();
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
