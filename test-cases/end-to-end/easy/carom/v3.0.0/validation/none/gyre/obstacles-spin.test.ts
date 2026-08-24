// gyre/obstacles-spin — each obstacle rotates about its own center at the
// fixed rate.
//
// specs/playfield.md: `theta(t) = OBSTACLE_SPIN_RATE * t`, in radians, the
// same direction for both obstacles, upright at `t = 0`, and the live pose is
// recomputed from the clock rather than integrated. `setObstacleClock` poses
// the clock and holds it there, so each obstacle's `theta` is read back at
// three posed times against that formula, to a hundredth of a radian (rounding
// room on a value the build computes directly). Nothing here computes the
// pose: it poses the CLOCK and reads what the build's own update made of it.
// A rotation is about the obstacle's own center, so `cx` stays on the base x.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertLessThanOrEqual,
} from "../assert";
import { OBSTACLE_CENTERS, OBSTACLE_SPIN_RATE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { angleDelta, poseObstacles, type ObstaclePose } from "./harness";

/** The clock times posed: upright, a quarter turn, and a half turn on. */
const TIMES = [0, 0.5, 1.0];

const THETA_TOLERANCE = 0.01;

/** Frames of the clock swept for the replay, after the readings are taken. */
const SWEEP_FRAMES = 90;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("rotates both obstacles about their own centers at OBSTACLE_SPIN_RATE", async () => {
  const { debug } = harness;
  await debug.reset();
  await debug.startMatch("versus");

  const samples: ObstaclePose[][] = [];
  await captureReplay(harness, "spin", async () => {
    for (const t of TIMES) samples.push(await poseObstacles(harness, t));

    // The rest of the recording is a sweep of the clock, so the clip shows the
    // rotation the readings above sampled. Nothing below reads it.
    const from = TIMES[0]!;
    const span = TIMES[TIMES.length - 1]! - from;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, from + (span * i) / SWEEP_FRAMES);
  });

  for (const [k, t] of TIMES.entries()) {
    const expected = OBSTACLE_SPIN_RATE * t;
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      const pose = samples[k]![i]!;
      assertLessThanOrEqual(
        Math.abs(angleDelta(pose.theta, expected)),
        THETA_TOLERANCE,
        `obstacle ${i} at t = ${t}: theta`,
      );
      assertCloseTo(pose.cx, base.x, 6, `obstacle ${i} at t = ${t}: cx`);
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
