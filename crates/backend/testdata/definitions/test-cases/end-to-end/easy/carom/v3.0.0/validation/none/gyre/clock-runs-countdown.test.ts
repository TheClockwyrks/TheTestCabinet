// gyre/clock-runs-countdown — the obstacle clock advances during the pre-serve
// countdown.
//
// specs/playfield.md: the obstacle clock advances by the frame's delta time on
// every frame of a live match, the countdown included, and
// `theta(t) = OBSTACLE_SPIN_RATE * t`. The countdown is opened through the
// surface, which touches neither `setObstacleClock` nor
// `setObstacleClockRunning` — the two operations a check about the clock RUNNING
// must not touch — and both obstacles' rotations are read at two countdown
// frames a known number of frames apart. The turn between them is the rate times
// that span, within the same 0.01 radians `obstacles-spin` allows.
//
// The menus are not driven to get here. The screen this reads the clock on is
// the check's ground rather than its subject, so a build with a broken title
// menu fails the navigation points and still has this one graded on the clock.
//
// THE FIELD IS EMPTIED AND THE TWO OBSTACLES SPAWNED BACK, and that is all this
// check's world holds. The clock is the subject and the obstacles are what
// reports it; the ball is nothing to do with either, and an absent ball takes no
// part in a frame (specs/instrumentation.md), so there is nothing left to serve
// and the countdown this check measures across runs on indefinitely rather than
// having to be finished inside a hold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { OBSTACLE_CENTERS, OBSTACLE_SPIN_RATE } from "../constants";
import {
  captureReplay,
  clearField,
  createHarness,
  openCountdown,
  seconds,
  spawnObstacles,
  type Harness,
} from "../harness";
import {
  BOTH_OBSTACLES,
  angleDelta,
  obstacleAt,
  readObstacles,
} from "./harness";

/** Frames advanced between the two readings. */
const SPAN_TICKS = 30; // 0.25 s

/** The review item's margin, in radians. */
const ANGLE_TOLERANCE = 0.01;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("turns the obstacles while the countdown runs", async () => {
  await openCountdown(harness, "versus");
  assertEqual((await harness.snapshot()).screen, "countdown");
  await clearField(harness);
  await spawnObstacles(harness, BOTH_OBSTACLES);
  const opening = await readObstacles(harness);

  await captureReplay(harness, "countdown", async () => {
    await harness.advance(SPAN_TICKS);
  });

  assertEqual((await harness.snapshot()).screen, "countdown");
  const later = await readObstacles(harness);
  const expectedTurn = OBSTACLE_SPIN_RATE * seconds(SPAN_TICKS);
  for (const [i] of OBSTACLE_CENTERS.entries()) {
    const before = obstacleAt(opening, i);
    const after = obstacleAt(later, i);
    assertLessThanOrEqual(
      Math.abs(angleDelta(after.theta, before.theta + expectedTurn)),
      ANGLE_TOLERANCE,
      `obstacle ${i} turned OBSTACLE_SPIN_RATE * elapsed during the countdown`,
    );
  }
});
