// gameplay/serve-speed — a served ball leaves at the base serve speed.
//
// A fresh match is opened on its countdown and its pre-serve hold cut to nothing;
// the LAUNCH itself is the build's own, on the frame after, and the speed is read
// the instant it happens — before a bounce or a paddle could change it. Nothing
// about the serve is posed: opening the countdown says which screen the game is
// on, cutting the hold says when, and what LEAVES is whatever the build's own
// serve rule produced.
//
// The field holds the one ball whose serve is the subject, spawned back HELD at
// its home with a full hold timer: both obstacles are removed, so the recorded
// flight after the reading crosses an empty court. Nothing is taken from the
// player — no paddle is driven, and neither of them can reach the ball inside the
// three quarters of a second recorded.

import { afterEach, beforeEach, it } from "vitest";
import { SERVE_SPEED } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  driveServe,
  openCountdown,
  poseWorld,
  stageServe,
  type Harness,
} from "../harness";

/**
 * The review item's margin: one percent of SERVE_SPEED. The serve leaves at
 * exactly SERVE_SPEED (specs/balls.md) and is read on the launch frame, on which
 * it is not advanced.
 */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/**
 * Frames of the pre-serve hold recorded before the hold is expired.
 *
 * A recording that opened on the launch frame would drop a reviewer into a ball
 * already in flight; opening on the held ball is what makes the launch something
 * they watch HAPPEN. It cannot move what is measured: cutting the hold to zero
 * sets one field, the launch is still the build's own on the frame after it,
 * and what leaves a countdown is not a function of how long the countdown had
 * been running when it was cut short.
 */
const HELD_TICKS = 24; // 0.2 s

/**
 * Frames of the served flight recorded after the launch.
 *
 * The reading is taken on the launch frame — before a wall or a paddle could
 * change the ball — and that instant does not move. But a serve is only visible
 * as a serve once the ball has travelled, so the flight is driven after the
 * reading, inside the same recorded section, where it cannot reach an assertion.
 */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("serves the ball at the base serve speed", async () => {
  openCountdown(harness, "versus");
  poseWorld(harness, { live: false });

  const launched = await captureReplay(harness, "serve", async () => {
    await harness.advance(HELD_TICKS);
    stageServe(harness);
    const swept = await driveServe(harness);
    await harness.advance(FLIGHT_TICKS);
    return swept;
  });

  assertEqual(launched.hit, true);
  assertLessThanOrEqual(
    Math.abs(ball0(launched.snapshot).speed - SERVE_SPEED),
    SPEED_TOLERANCE,
  );
  assertDeepEqual(harness.assetFailures, []);
});
