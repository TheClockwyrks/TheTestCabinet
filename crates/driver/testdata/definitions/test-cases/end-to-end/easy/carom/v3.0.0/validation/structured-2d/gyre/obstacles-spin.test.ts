// gyre/obstacles-spin — each obstacle rotates about its own center at the
// specified rate.
//
// Three posed clock times, read back through the build's own update.
// specs/playfield.md fixes `theta(t) = OBSTACLE_SPIN_RATE * t`, the same
// direction for both obstacles, upright at 0, so each reported angle is held to
// the formula within the review item's 0.01 radians, modulo a full turn. The
// center stays where it is: a rotation walks nothing across the field.
//
// The field holds the two obstacles and NOTHING else. They are the whole of what
// this point is about, so the ball a match start would leave waiting is taken off
// the field rather than left to serve itself into the middle of the sweep — the
// posed clock is the only thing driving anything here.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLE_CENTERS, OBSTACLE_SPIN_RATE } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  ALL_OBSTACLES,
  captureReplay,
  createHarness,
  isolateField,
  openCountdown,
  type Harness,
} from "../harness";
import {
  angleDelta,
  obstacleAt,
  poseObstacles,
  type ObstaclePose,
} from "./harness";

/** The three clock times the obstacles are posed at, in seconds. */
const TIMES = [0, 0.5, 1.0];

/** The review item's margin, in radians. */
const ANGLE_TOLERANCE = 0.01;

/** A float margin on the center, in logical units. */
const CENTER_TOLERANCE = 1e-6;

/**
 * A fine sweep of the same span, posed after every graded sample has been
 * taken, so the clip shows the obstacles turning rather than three still fields.
 */
const SWEEP_FRAMES = 90;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("rotates both obstacles about their own centers at OBSTACLE_SPIN_RATE", async () => {
  await openCountdown(harness, "versus");
  // Both obstacles, no ball: the subject of the point, and nothing else.
  isolateField(harness, { balls: 0, obstacles: ALL_OBSTACLES });

  const samples: ObstaclePose[][] = [];
  await captureReplay(harness, "spin", async () => {
    for (const t of TIMES) samples.push(await poseObstacles(harness, t));

    const from = TIMES[0]!;
    const span = TIMES[TIMES.length - 1]! - from;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, from + (span * i) / SWEEP_FRAMES);
  });

  for (const [k, t] of TIMES.entries()) {
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      const pose = obstacleAt(samples[k]!, i);
      assertLessThanOrEqual(
        Math.abs(angleDelta(pose.theta, OBSTACLE_SPIN_RATE * t)),
        ANGLE_TOLERANCE,
        `obstacle ${i} at t=${t}: theta is OBSTACLE_SPIN_RATE * t`,
      );
      // The sway moves y, so only x is held here; y is `obstacles-sway`'s.
      assertLessThanOrEqual(Math.abs(pose.cx - base.x), CENTER_TOLERANCE);
    }
  }
});
