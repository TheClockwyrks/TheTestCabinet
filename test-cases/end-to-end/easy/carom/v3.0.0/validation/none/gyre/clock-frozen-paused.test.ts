// gyre/clock-frozen-paused — the obstacle clock is frozen while the game is
// paused.
//
// specs/playfield.md and specs/ui.md: the obstacle clock is frozen while the
// game is paused, so both obstacles hold their pose. A match is started from
// the title with the menu keys alone and paused with a real key, so no control
// operation holds the clock; each obstacle's center and rotation are then read
// on the paused frame and again after a long paused stretch, and must be
// unchanged. The margin is a float rounding: a single leaked frame turns an
// obstacle by over 0.008 radians.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";
import { readObstacles } from "./harness";

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
  await startWithKeys(harness, "versus");
  await harness.advance(RUN_TICKS);
  await harness.tap("Escape");
  assertEqual((await harness.snapshot()).screen, "paused");
  const paused = await readObstacles(harness);

  await captureReplay(harness, "paused", async () => {
    await harness.advance(PAUSED_TICKS);
  });

  assertEqual((await harness.snapshot()).screen, "paused");
  const later = await readObstacles(harness);
  for (const [i, before] of paused.entries()) {
    const after = later[i]!;
    for (const field of ["cx", "cy", "theta"] as const) {
      assertLessThanOrEqual(
        Math.abs(after[field] - before[field]),
        POSE_TOLERANCE,
        `obstacle ${i} ${field} held while paused`,
      );
    }
  }
});
