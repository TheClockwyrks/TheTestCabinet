// gyre/obstacles-sway — the obstacles move: each sways vertically about its base
// center as the obstacle clock advances, and the two sway in opposite directions
// so the field stays balanced.
//
// `setObstacleClock` poses the clock and holds it there, so the check reads each
// obstacle's center back at two known times — upright at 0, and a quarter of the
// sway period later, where the sway is at its peak. Nothing here computes the
// pose: it poses the CLOCK and reads back what the build's own update made of
// it, which is the thing being graded.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLE_CENTERS, OBSTACLE_SWAY_AMP } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { PEAK_SWAY_T, poseObstacles } from "./harness";

/**
 * How far off its base an obstacle must have travelled to count as swaying.
 *
 * Most of the stated amplitude, so a build that merely jitters its obstacles
 * fails while one that is a little off the exact sinusoid still passes.
 */
const MOVE_MIN = OBSTACLE_SWAY_AMP * 0.6;

/**
 * A fine sweep of a whole sway period, posed after both graded samples are taken.
 *
 * `setObstacleClock` poses the clock and HOLDS it there, so the two graded
 * samples are one frame each: a recording of them alone is a cut between two
 * still fields, and the review item promises a reviewer the obstacles SWAYING.
 * A full period walked in small steps carries each obstacle out to both peaks and
 * back, which is the whole of the motion.
 *
 * It runs after both samples are read, so nothing it poses can reach an
 * assertion.
 */
const SWEEP_FRAMES = 96;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sways both obstacles vertically, in anti-phase", async () => {
  const { debug } = harness;
  await debug.reset();
  await debug.startMatch("versus");

  // Both poses as one section: a pose is instantaneous and it is the FRAME after
  // it that recomputes the field, so the recording is the upright field followed
  // by the swayed one.
  await captureReplay(harness, "sway", async () => {
    // Clock zero is the upright pose: both obstacles sit on their base centers.
    const at0 = await poseObstacles(harness, 0);
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      expect(at0[i]!.cx).toBeCloseTo(base.x, 0);
      expect(at0[i]!.cy).toBeCloseTo(base.y, 0);
    }

    // A quarter period on, the sway is at full amplitude.
    const atPeak = await poseObstacles(harness, PEAK_SWAY_T);

    // Both readings are frozen above, so this reaches no assertion below.
    const period = PEAK_SWAY_T * 4;
    for (let i = 0; i <= SWEEP_FRAMES; i += 1)
      await poseObstacles(harness, (period * i) / SWEEP_FRAMES);

    const moved = OBSTACLE_CENTERS.map(
      (base, i) => atPeak[i]!.cy - (at0[i]!.cy ?? base.y),
    );
    for (const [i] of OBSTACLE_CENTERS.entries()) {
      expect(
        Math.abs(moved[i]!),
        `obstacle ${i} should have swayed well off its base y`,
      ).toBeGreaterThan(MOVE_MIN);
    }

    // Anti-phase: one goes up while the other goes down, which is what keeps the
    // layout point-symmetric and neither half of the field busier.
    expect(Math.sign(moved[0]!)).toBe(-Math.sign(moved[1]!));

    // The sway is vertical only — an obstacle never drifts across the field.
    for (const [i, base] of OBSTACLE_CENTERS.entries()) {
      expect(atPeak[i]!.cx).toBeCloseTo(base.x, 0);
    }
  });

  // Nothing the page threw or logged as an error while this harness drove it.
  expect(harness.pageErrors).toEqual([]);
});
