// gyre/clock-frozen-paused — the obstacle clock is frozen while the game is
// paused.
//
// specs/playfield.md and specs/ui.md: the obstacle clock is frozen while the
// game is paused, so both obstacles hold their pose. The countdown is opened
// through the surface, run for a real quarter second so the clock is genuinely
// moving, and the pause is then POSED — the three fields specs/ui.md says a
// `pause` edge sets, and neither `setObstacleClock` nor
// `setObstacleClockRunning`, which are the two operations a check about the
// clock freezing on its own must not touch. Each obstacle's center and rotation
// are read on the paused frame and again after a long paused stretch, and must
// be unchanged. The margin is a float rounding: a single leaked frame turns an
// obstacle by over 0.008 radians.
//
// Neither the menus nor the pause key is driven to get here. Both are other
// points' subjects — the title menu's the navigation checks', `Escape`'s
// `controls-versus/escape`'s — and pressing them here would fail this point for
// a defect that is not the clock's.
//
// THE FIELD IS EMPTIED AND THE TWO OBSTACLES SPAWNED BACK, and that is all this
// check's world holds. What must hold still is the obstacle pose; a ball is
// nothing to do with it, and leaving one on the field would put a body in the
// clip that the review point never mentions. The obstacles are given a quarter
// of a second of real countdown first, so what freezes is a pose mid-sway and
// mid-turn rather than the upright one a build could reach by never moving them
// at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { OBSTACLE_CENTERS } from "../constants";
import {
  captureReplay,
  clearField,
  createHarness,
  openCountdown,
  spawnObstacles,
  type Harness,
} from "../harness";
import { BOTH_OBSTACLES, obstacleAt, readObstacles } from "./harness";

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

afterEach(async () => {
  await harness.dispose();
});

it("holds the obstacles still while paused", async () => {
  await openCountdown(harness, "versus");
  await clearField(harness);
  await spawnObstacles(harness, BOTH_OBSTACLES);
  await harness.advance(RUN_TICKS);

  await harness.debug.setResumeScreen("countdown");
  await harness.debug.setMenuIndex(0);
  await harness.debug.setScreen("paused");
  assertEqual((await harness.snapshot()).screen, "paused");
  const paused = await readObstacles(harness);

  await captureReplay(harness, "paused", async () => {
    await harness.advance(PAUSED_TICKS);
  });

  assertEqual((await harness.snapshot()).screen, "paused");
  const later = await readObstacles(harness);
  for (const [i] of OBSTACLE_CENTERS.entries()) {
    const before = obstacleAt(paused, i);
    const after = obstacleAt(later, i);
    for (const field of ["cx", "cy", "theta"] as const) {
      assertLessThanOrEqual(
        Math.abs(after[field] - before[field]),
        POSE_TOLERANCE,
        `obstacle ${i} ${field} held while paused`,
      );
    }
  }
});
