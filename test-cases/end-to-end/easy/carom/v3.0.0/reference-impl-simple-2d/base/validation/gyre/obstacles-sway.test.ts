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
import { OBSTACLE_CENTERS, OBSTACLE_SWAY_AMP } from "../../src/constants";
import { createHarness, type Harness } from "../harness";
import { PEAK_SWAY_T, poseObstacles } from "./harness";

/**
 * How far off its base an obstacle must have travelled to count as swaying.
 *
 * Most of the stated amplitude, so a build that merely jitters its obstacles
 * fails while one that is a little off the exact sinusoid still passes.
 */
const MOVE_MIN = OBSTACLE_SWAY_AMP * 0.6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("sways both obstacles vertically, in anti-phase", async () => {
  const { debug } = harness;
  debug.reset();
  debug.startMatch("versus");

  // Clock zero is the upright pose: both obstacles sit on their base centers.
  const at0 = await poseObstacles(harness, 0);
  for (const [i, base] of OBSTACLE_CENTERS.entries()) {
    expect(at0[i]!.cx).toBeCloseTo(base.x, 0);
    expect(at0[i]!.cy).toBeCloseTo(base.y, 0);
  }

  // A quarter period on, the sway is at full amplitude.
  const atPeak = await poseObstacles(harness, PEAK_SWAY_T);

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

  expect(harness.assetFailures).toEqual([]);
});
