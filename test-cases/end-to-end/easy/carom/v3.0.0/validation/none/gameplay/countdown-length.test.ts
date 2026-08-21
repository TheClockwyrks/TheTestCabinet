// gameplay/countdown-length — the pre-serve countdown lasts the specified hold.
//
// The match is started FROM THE TITLE with menu keys, not through the debug
// API's `startMatch`: that operation sets the hold itself, so a check that used
// it would be measuring the case's own code rather than the build's. Confirming
// the entry the player takes is what makes the duration the build's.
//
// From there the real simulation is stepped ONE FRAME at a time until the ball
// serves. At the harness's 120 Hz clock the hold is a whole number of frames, so
// the count is the duration.

import { afterEach, beforeEach, expect, it } from "vitest";
import { HOLD_TIME } from "../../src/constants";
import {
  TICK_HZ,
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";

/** The hold, in frames of the harness's clock. */
const HOLD_TICKS = HOLD_TIME * TICK_HZ;
/**
 * The old browser suite's margin: three ticks either side. Enough to absorb the
 * frame the menu confirm was delivered on, and nothing like enough to hide a
 * hold of the wrong length.
 */
const TOLERANCE_TICKS = 3;
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
  harness.dispose();
});

it("holds the ball for the pre-serve countdown, then serves", async () => {
  await startWithKeys(harness, "versus");

  const start = harness.snapshot();
  expect(start.screen).toBe("countdown");
  expect(start.ball.held).toBe(true);

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

  expect(served.hit).toBe(true);
  expect(Math.abs(served.frames - HOLD_TICKS)).toBeLessThanOrEqual(
    TOLERANCE_TICKS,
  );
  expect(served.snapshot.ball.speed).toBeGreaterThan(1);
});
