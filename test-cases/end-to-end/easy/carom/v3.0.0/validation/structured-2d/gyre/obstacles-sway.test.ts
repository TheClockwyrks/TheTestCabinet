// gyre/obstacles-sway — each obstacle sways vertically about its base center,
// and the two sway in anti-phase.
//
// `setObstacleClock` poses the clock and `setObstacleClockRunning(false)` holds
// it there, so each obstacle's center is read back at two clock times a quarter
// period apart: 0, where both sit on their base centers, and
// OBSTACLE_SWAY_PERIOD / 4, the peak of the sway. specs/playfield.md fixes the
// poses: obstacle A at
// `220 + OBSTACLE_SWAY_AMP * sin(2*pi*t / OBSTACLE_SWAY_PERIOD)`, obstacle B at
// `500 - ...`, and `x` unchanged. Nothing here computes the pose the build
// reports; it poses the CLOCK and reads back what the build's own update made
// of it, against the formula, within the review item's one unit.
//
// The field holds the two obstacles and NOTHING else. They are the whole of what
// this point is about, so the ball a match start would leave waiting is taken off
// the field rather than left to serve itself into the middle of the sweep.

import { afterEach, beforeEach, it } from "vitest";
import {
  OBSTACLE_CENTERS,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  ALL_OBSTACLES,
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  type Harness,
} from "../harness";
import { PEAK_SWAY_T, obstacleAt, poseObstacles } from "./harness";

/** The review item's margin, in logical units. */
const POSE_TOLERANCE = 1;

/**
 * A fine sweep of a whole sway period, posed after both graded samples are
 * taken, so the clip shows the obstacles swaying rather than two still fields.
 */
const SWEEP_FRAMES = 96;

/** The specified vertical offset of obstacle `index` from its base at clock `t`. */
function swayOffset(index: number, t: number): number {
  const sway =
    OBSTACLE_SWAY_AMP * Math.sin((2 * Math.PI * t) / OBSTACLE_SWAY_PERIOD);
  return index === 0 ? sway : -sway;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("sways both obstacles vertically on the specified sinusoid, in anti-phase", async () => {
  await openCountdown(harness, "versus");
  // Both obstacles, no ball: the subject of the point, and nothing else.
  isolateField(harness, { balls: 0, obstacles: ALL_OBSTACLES });

  await captureReplay(harness, "sway", async () => {
    for (const t of [0, PEAK_SWAY_T]) {
      const poses = await poseObstacles(harness, t);
      for (const [i, base] of OBSTACLE_CENTERS.entries()) {
        const pose = obstacleAt(poses, i);
        assertLessThanOrEqual(
          Math.abs(pose.cx - base.x),
          POSE_TOLERANCE,
          `obstacle ${i} at t=${t}: x stays on the base center`,
        );
        assertLessThanOrEqual(
          Math.abs(pose.cy - (base.y + swayOffset(i, t))),
          POSE_TOLERANCE,
          `obstacle ${i} at t=${t}: y follows the sway`,
        );
      }
    }

    // At the peak the two offsets are equal and opposite.
    const atPeak = await poseObstacles(harness, PEAK_SWAY_T);
    const offsets = OBSTACLE_CENTERS.map(
      (base, i) => obstacleAt(atPeak, i).cy - base.y,
    );
    assertEqual(Math.sign(offsets[0]!), -Math.sign(offsets[1]!));
    assertGreaterThan(Math.abs(offsets[0]!), POSE_TOLERANCE);

    // Both readings are taken above, so this reaches no assertion.
    const period = PEAK_SWAY_T * 4;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, (period * i) / SWEEP_FRAMES);
  });

  assertDeepEqual(harness.assetFailures, []);
});
