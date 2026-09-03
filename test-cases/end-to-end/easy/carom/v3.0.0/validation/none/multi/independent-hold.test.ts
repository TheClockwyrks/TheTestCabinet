// multi/independent-hold — every ball carries a hold of its own, and at match
// start all three run out together.
//
// A match is opened on its countdown, the field is cleared back to the three
// balls this point is about — each spawned onto its own home, held, with a full
// timer, which is the arrangement a match opens on — and the game is then
// stepped ONE FRAME AT A TIME until the first ball is seen in flight. At the
// harness's 120 Hz clock the hold is a whole number of frames, so the count is
// the duration, and the state read on that same frame says whether the other two
// left with it.
//
// The obstacles come off the field: three balls launching on three unrelated
// headings would meet them within the recorded flight, and this point is about
// the three timers rather than about anything they run into. What remains is the
// question — three balls, three holds, one launch frame.
//
// This is the multi counterpart of the single-ball countdown: there, one timer
// gates one ball; here, three timers start together, so they elapse together
// while staying each ball's own. The hold a RESPAWNED ball takes on its own is
// `multi/independent-respawn`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { BALL_COUNT } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  openCountdown,
  type MultiHarness,
} from "../harness";
import {
  HOLD_TICKS,
  HOLD_TOLERANCE_TICKS,
  driveLaunch,
  isolateBalls,
  readBalls,
} from "./harness";

/** Frames of the launched flight recorded after the hold runs out. */
const FLIGHT_TICKS = 60; // 0.5 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds all three balls for the hold, then launches them together", async () => {
  await openCountdown(h, "versus");
  await isolateBalls(h);

  const launch = await captureReplay(h, "launch", async () => {
    const first = await driveLaunch(h, 0);
    await h.advance(FLIGHT_TICKS);
    return first;
  });

  assertEqual(launch.hit, true);
  assertLessThanOrEqual(
    Math.abs(launch.frames - HOLD_TICKS),
    HOLD_TOLERANCE_TICKS,
  );
  // All three, read on the ONE frame the first ball left: whether the other two
  // left on it too is exactly the question, and a later read would answer it
  // about a later frame.
  const balls = readBalls(launch.snapshot);
  assertLength(balls, BALL_COUNT);
  for (const ball of balls) {
    assertEqual(ball.held, false);
    assertGreaterThan(ball.speed, 1);
  }
  // The holds started together, so they end together and the field goes live as
  // a whole.
  assertEqual(launch.snapshot.screen, "playing");
});
