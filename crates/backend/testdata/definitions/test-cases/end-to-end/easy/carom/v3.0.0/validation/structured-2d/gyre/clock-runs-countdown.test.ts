// gyre/clock-runs-countdown — the obstacle clock advances during the pre-serve
// countdown.
//
// specs/playfield.md: the obstacle clock advances by the frame's delta time on
// every frame of a live match, the countdown included, and
// `theta(t) = OBSTACLE_SPIN_RATE * t`. The countdown is opened through the
// surface, which poses neither `setObstacleClock` nor `setObstacleClockRunning`
// — exactly the two operations a check about the clock RUNNING must not touch —
// and both obstacles' rotations are read at two countdown frames a known number
// of frames apart. The turn between them is the rate times that span, within the
// same 0.01 radians `obstacles-spin` allows.
//
// The menus are not driven to get here. The screen this reads the clock on is
// the check's ground rather than its subject, so a build with a broken title
// menu fails the navigation points and still has this one graded on the clock.
//
// The field is left exactly as `stageMatchStart` made it: the two obstacles this
// point reads, and the ball whose waiting IS the countdown the clock is being
// watched through. Taking the ball off would take the screen with it, so there is
// no bystander here to remove.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLE_SPIN_RATE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openCountdown,
  seconds,
  type Harness,
} from "../harness";
import { angleDelta, obstacleAt, readObstacles } from "./harness";

/** Frames advanced between the two readings, well inside the hold. */
const SPAN_TICKS = 30; // 0.25 s of a 1 s countdown

/** The review item's margin, in radians. */
const ANGLE_TOLERANCE = 0.01;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("turns the obstacles while the countdown runs", async () => {
  await openCountdown(harness, "versus");
  assertEqual(harness.snapshot().screen, "countdown");
  const opening = readObstacles(harness);

  await captureReplay(harness, "countdown", async () => {
    await harness.advance(SPAN_TICKS);
  });

  assertEqual(harness.snapshot().screen, "countdown");
  const later = readObstacles(harness);
  const expectedTurn = OBSTACLE_SPIN_RATE * seconds(SPAN_TICKS);
  for (const before of opening) {
    const after = obstacleAt(later, before.index);
    assertLessThanOrEqual(
      Math.abs(angleDelta(after.theta, before.theta + expectedTurn)),
      ANGLE_TOLERANCE,
      `obstacle ${before.index} turned OBSTACLE_SPIN_RATE * elapsed during ` +
        `the countdown`,
    );
  }
});
