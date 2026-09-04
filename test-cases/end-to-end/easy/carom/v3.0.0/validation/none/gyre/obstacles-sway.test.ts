// gyre/obstacles-sway — each obstacle sways vertically about its base center,
// the two in anti-phase.
//
// specs/playfield.md: obstacle A's center y is
// `220 + OBSTACLE_SWAY_AMP * sin(2*pi * t / OBSTACLE_SWAY_PERIOD)` and B's is
// `500 - OBSTACLE_SWAY_AMP * sin(...)`, with `x` unchanged, and the live pose
// is recomputed from the clock. `setObstacleClock` poses the clock and
// `setObstacleClockRunning(false)` holds it there, so each obstacle's center is
// read back at two posed times a quarter period apart (upright at 0, and at the
// peak of the sway) against that formula, within a unit. Nothing here computes
// the pose: it poses the CLOCK and reads what the build's own update made of it.
//
// The field is emptied and the two obstacles are spawned back onto it alone.
// The anti-phase is a fact about the pair and nothing else, so nothing else is
// on the field to be swayed, struck, or watched — the clip is two bars sliding
// past each other on an empty field.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  OBSTACLE_CENTERS,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolateObstacles,
  openCountdown,
  type Harness,
} from "../harness";
import {
  BOTH_OBSTACLES,
  PEAK_SWAY_T,
  obstacleAt,
  poseObstacles,
  type ObstaclePose,
} from "./harness";

const TIMES = [0, PEAK_SWAY_T];
const SWAY_TOLERANCE = 1;

/** Frames of the clock swept for the replay, after the readings are taken. */
const SWEEP_FRAMES = 96;

/** The sway the formula gives obstacle `i` at clock `t`: A's sign, B's the opposite. */
function swayAt(i: number, t: number): number {
  const s =
    OBSTACLE_SWAY_AMP * Math.sin((2 * Math.PI * t) / OBSTACLE_SWAY_PERIOD);
  return i === 0 ? s : -s;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sways both obstacles vertically by the formula, in anti-phase", async () => {
  await openCountdown(harness, "versus");
  await isolateObstacles(harness, BOTH_OBSTACLES);

  const samples: ObstaclePose[][] = [];
  await captureReplay(harness, "sway", async () => {
    for (const t of TIMES) samples.push(await poseObstacles(harness, t));

    // The rest of the recording is a sweep of one period, so the clip shows the
    // sway the readings above sampled. Nothing below reads it.
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, (OBSTACLE_SWAY_PERIOD * i) / SWEEP_FRAMES);
  });

  for (const [k, t] of TIMES.entries()) {
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      const pose = obstacleAt(samples[k], i);
      assertLessThanOrEqual(
        Math.abs(pose.cy - (base.y + swayAt(i, t))),
        SWAY_TOLERANCE,
        `obstacle ${i} at t = ${t}: cy`,
      );
      assertCloseTo(pose.cx, base.x, 6, `obstacle ${i} at t = ${t}: cx`);
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  assertDeepEqual(harness.pageErrors, []);
});
