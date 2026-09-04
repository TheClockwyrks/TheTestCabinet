// gyre/clock-frozen-paused — the obstacle clock is frozen while the game is
// paused.
//
// specs/playfield.md and specs/ui.md: the obstacle clock is frozen while the
// game is paused, so both obstacles hold their pose. A match is started from
// the title with the menu keys alone and paused with a real key, so nothing on
// the surface poses or holds the clock; each obstacle's center and rotation are
// then read on the paused frame and again after a long paused stretch, and must
// be unchanged. The margin is a float rounding: a single leaked frame turns an
// obstacle by over 0.008 radians.
//
// The field is the one the build's own match start built, and deliberately so.
// What is under test is that a PAUSE stops the clock, so the clock has to be
// running when the pause arrives — which is what the countdown the held ball
// keeps the game on gives. Emptying the field would end that countdown, and
// posing the clock would hold it still for reasons that are not the pause's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";
import { obstaclePose, readObstacles, thetaOf } from "./harness";

/** Frames of countdown run before the pause, so the obstacles are mid-motion. */
const RUN_TICKS = 30; // 0.25 s
/** Frames spent paused. */
const PAUSED_TICKS = 180; // 1.5 s

/** A float margin on the held pose. */
const POSE_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("holds the obstacles still while paused", async () => {
  await startWithKeys(harness, "versus");
  await harness.advance(RUN_TICKS);
  await harness.tap("Escape");
  assertEqual(harness.snapshot().screen, "paused");
  const paused = readObstacles(harness);

  await captureReplay(harness, "paused", async () => {
    await harness.advance(PAUSED_TICKS);
  });

  assertEqual(harness.snapshot().screen, "paused");
  const later = readObstacles(harness);
  for (const before of paused) {
    const after = obstaclePose(later, before.index);
    assertLessThanOrEqual(
      Math.abs(after.cx - before.cx),
      POSE_TOLERANCE,
      `obstacle ${before.index} cx held while paused`,
    );
    assertLessThanOrEqual(
      Math.abs(after.cy - before.cy),
      POSE_TOLERANCE,
      `obstacle ${before.index} cy held while paused`,
    );
    assertLessThanOrEqual(
      Math.abs(thetaOf(after) - thetaOf(before)),
      POSE_TOLERANCE,
      `obstacle ${before.index} theta held while paused`,
    );
  }
});
