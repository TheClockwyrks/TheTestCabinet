// multi/independent-hold — every ball carries a hold of its own, and at match
// start all three run out together.
//
// The match is opened through `startMatch` and then stepped ONE FRAME AT A TIME
// until the first ball is seen in flight. At the harness's 120 Hz clock the hold
// is a whole number of frames, so the count is the duration — and the state read
// on that same frame says whether the other two left with it.
//
// This is the multi counterpart of the single-ball countdown: there, one timer
// gates one ball; here, three timers start together, so they elapse together
// while staying each ball's own. The hold a RESPAWNED ball takes on its own is
// `multi/independent-respawn`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  driveLaunch,
  readBalls,
} from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds all three balls for the hold, then launches them together", async () => {
  h.debug.reset();
  h.debug.startMatch("versus");

  const launch = await captureReplay(h, "launch", async () => {
    const first = await driveLaunch(h, 0);
    // Read HERE, on the frame the first ball left: whether the other two left on
    // it too is exactly the question, and a later read would answer it about a
    // later frame.
    const balls = readBalls(h.snapshot());
    const { screen } = h.snapshot();
    await h.advance(FLIGHT_TICKS);
    return { first, balls, screen };
  });

  expect(launch.first.hit).toBe(true);
  expect(Math.abs(launch.first.frames - HOLD_TICKS)).toBeLessThanOrEqual(
    HOLD_TOLERANCE_TICKS,
  );
  // All three, on that one frame: the holds started together, so they end
  // together and the field goes live as a whole.
  for (const ball of launch.balls) {
    expect(ball.held).toBe(false);
    expect(ball.speed).toBeGreaterThan(1);
  }
  expect(launch.screen).toBe("playing");
});
