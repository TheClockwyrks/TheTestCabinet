// gyre/clock-frozen-paused — the obstacle clock is frozen while the game is
// paused.
//
// specs/playfield.md and specs/ui.md: the obstacle clock is frozen while the
// game is paused, so both obstacles hold their pose. A match is started from
// the title with the menu keys alone and paused with a real key, so nothing here
// poses the clock — `setObstacleClockRunning` is the one operation a check about
// the clock freezing ON ITS OWN must not touch; each obstacle's center and
// rotation are then read on the paused frame and again after a long paused
// stretch, and must be unchanged. The margin is a float rounding: a single
// leaked frame turns an obstacle by over 0.008 radians.
//
// The field is left exactly as the build's own match start made it: the two
// obstacles this point reads, and the ball whose waiting IS the countdown the
// pause is opened from. Taking the ball off would take the screen with it, so
// there is no bystander here to remove.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";
import { obstacleAt, readObstacles } from "./harness";

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
    const after = obstacleAt(later, before.index);
    for (const field of ["cx", "cy", "theta"] as const) {
      assertLessThanOrEqual(
        Math.abs(after[field] - before[field]),
        POSE_TOLERANCE,
        `obstacle ${before.index} ${field} held while paused`,
      );
    }
  }
});
