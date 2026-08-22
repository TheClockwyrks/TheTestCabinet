// gyre/obstacles-spin — the obstacles rotate: each spins about its own center as
// the obstacle clock advances, presenting continuously tilting faces.
//
// Three posed clock times, read back through the build's own update: upright at
// 0, then turned further at each later time. The check is on the ANGLE the build
// reports, and it is asserted as a monotone, non-trivial progression rather than
// against the exact radian, so a build whose spin direction or phase differs
// still passes while one whose obstacles never turn fails.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLE_CENTERS, OBSTACLE_SPIN_RATE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { angleDelta, poseObstacles, type ObstaclePose } from "./harness";

/** The three clock times the obstacles are posed at, in seconds. */
const TIMES = [0, 0.75, 1.5];

/**
 * The least the angle must have moved between two samples, in radians.
 *
 * Most of what the stated rate covers in the interval, so a build that is a
 * little off the exact rate passes and one whose obstacles are static fails.
 */
const TURN_MIN = OBSTACLE_SPIN_RATE * (TIMES[1]! - TIMES[0]!) * 0.6;

/**
 * A fine sweep of the same span, posed after every graded sample has been taken.
 *
 * `setObstacleClock` poses the clock and HOLDS it there, so the graded samples
 * are one frame each: a recording of them alone is a jump cut between still
 * fields, and the review item promises a reviewer the obstacles MOVING. Walking
 * the same span in small steps gives the clip the motion the check is about.
 *
 * It runs strictly after `samples` is complete, so nothing it poses can reach an
 * assertion — what is graded is the same poses, read at the same clock times, as
 * before this sweep existed.
 */
const SWEEP_FRAMES = 90;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("rotates both obstacles about their own centers as the clock runs", async () => {
  const { debug } = harness;
  await debug.reset();
  await debug.startMatch("versus");

  // Annotated rather than inferred: the pushes happen inside the recorded
  // section's closure, which is out of the flow the empty literal is widened by.
  const samples: ObstaclePose[][] = [];
  await captureReplay(harness, "spin", async () => {
    for (const t of TIMES) samples.push(await poseObstacles(harness, t));

    const from = TIMES[0]!;
    const span = TIMES[TIMES.length - 1]! - from;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, from + (span * i) / SWEEP_FRAMES);
  });

  // The field starts upright, so the motion is visibly a rotation FROM
  // somewhere rather than an arbitrary fixed tilt.
  for (const [i] of OBSTACLE_CENTERS.entries()) {
    expect(
      Math.abs(angleDelta(samples[0]![i]!.theta, 0)),
      `obstacle ${i} should start upright at clock 0`,
    ).toBeLessThan(0.05);
  }

  for (const [i] of OBSTACLE_CENTERS.entries()) {
    const turns = [
      angleDelta(samples[1]![i]!.theta, samples[0]![i]!.theta),
      angleDelta(samples[2]![i]!.theta, samples[1]![i]!.theta),
    ];
    for (const turn of turns) {
      expect(
        Math.abs(turn),
        `obstacle ${i} should keep turning as the clock advances`,
      ).toBeGreaterThan(TURN_MIN);
    }
    // Continuous rotation, not an oscillation: both intervals turn the same way.
    expect(
      Math.sign(turns[0]!),
      `obstacle ${i} should keep turning the same way`,
    ).toBe(Math.sign(turns[1]!));
  }

  // Both turn the same way as each other, which is what the specification fixes.
  const first = angleDelta(samples[1]![0]!.theta, samples[0]![0]!.theta);
  const second = angleDelta(samples[1]![1]!.theta, samples[0]![1]!.theta);
  expect(Math.sign(first)).toBe(Math.sign(second));

  // A rotation is about the obstacle's OWN center: turning it must not have
  // walked it across the field.
  for (const [i, base] of OBSTACLE_CENTERS.entries()) {
    for (const sample of samples) {
      expect(sample[i]!.cx).toBeCloseTo(base.x, 0);
    }
  }

  // Nothing the page threw or logged as an error while this harness drove it.
  expect(harness.pageErrors).toEqual([]);
});
