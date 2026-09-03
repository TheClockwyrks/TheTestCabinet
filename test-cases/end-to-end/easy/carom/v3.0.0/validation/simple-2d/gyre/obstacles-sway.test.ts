// gyre/obstacles-sway — each obstacle sways vertically about its base center,
// and the two sway in anti-phase.
//
// `setObstacleClock` poses the clock and holds it there, so each obstacle's
// center is read back at two clock times a quarter period apart: 0, where both
// sit on their base centers, and OBSTACLE_SWAY_PERIOD / 4, the peak of the sway.
// specs/playfield.md fixes the poses: obstacle A at
// `220 + OBSTACLE_SWAY_AMP * sin(2*pi*t / OBSTACLE_SWAY_PERIOD)`, obstacle B at
// `500 - ...`, and `x` unchanged. Nothing here computes the pose the build
// reports; it poses the CLOCK and reads back what the build's own update made
// of it, against the formula, within the review item's one unit.

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
import { captureReplay, createHarness, type Harness } from "../harness";
import { PEAK_SWAY_T, poseObstacles } from "./harness";

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
  const { debug } = harness;
  debug.reset();
  debug.startMatch("versus");

  await captureReplay(harness, "sway", async () => {
    for (const t of [0, PEAK_SWAY_T]) {
      const poses = await poseObstacles(harness, t);
      for (const [i, base] of OBSTACLE_CENTERS.entries()) {
        assertLessThanOrEqual(
          Math.abs(poses[i]!.cx - base.x),
          POSE_TOLERANCE,
          `obstacle ${i} at t=${t}: x stays on the base center`,
        );
        assertLessThanOrEqual(
          Math.abs(poses[i]!.cy - (base.y + swayOffset(i, t))),
          POSE_TOLERANCE,
          `obstacle ${i} at t=${t}: y follows the sway`,
        );
      }
    }

    // At the peak the two offsets are equal and opposite.
    const atPeak = await poseObstacles(harness, PEAK_SWAY_T);
    const offsets = OBSTACLE_CENTERS.map((base, i) => atPeak[i]!.cy - base.y);
    assertEqual(Math.sign(offsets[0]!), -Math.sign(offsets[1]!));
    assertGreaterThan(Math.abs(offsets[0]!), POSE_TOLERANCE);

    // Both readings are taken above, so this reaches no assertion.
    const period = PEAK_SWAY_T * 4;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, (period * i) / SWEEP_FRAMES);
  });

  assertDeepEqual(harness.assetFailures, []);
});
