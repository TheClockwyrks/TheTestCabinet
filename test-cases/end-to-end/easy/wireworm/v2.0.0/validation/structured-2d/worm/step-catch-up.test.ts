// worm/step-catch-up — a long frame runs every step it covered, and carries the
// remainder into the next one.
//
// specs/worm.md, The step clock: "Each time the accumulated time reaches the
// level's step interval, the worm takes one step and the interval is taken off
// the accumulator, so a frame covering several intervals runs several steps in
// order and the remainder carries into the next frame."
//
// HOW THE LONG FRAME IS MADE. The runtime's clock is the harness's to choose,
// so this check builds its runtime over a `ConstantClock` whose every frame is
// worth `3.6` of level 1's `0.14` s intervals — `0.504` s. Nothing about the
// build changes; it is handed a bigger delta, which is exactly what a stalled
// display hands a real one.
//
// WHY 3.6 INTERVALS, AND WHY TWO FRAMES. The fraction is what makes the two
// halves of the rule separable:
//
//   frame 1: 3.6 intervals accumulated -> 3 steps run, 0.6 carried
//   frame 2: 0.6 + 3.6 = 7.2 accumulated -> 4 more steps, 7 in all
//
// A build that runs one step per frame however long it was ends at 2. A build
// that runs the steps but DROPS the remainder ends at 6, because its second
// frame covers 3.6 intervals afresh. Only a build that carries the remainder
// reaches 7. Both readings sit 0.4 and 0.2 of an interval clear of a boundary,
// so no rounding of the accumulator decides the answer.
//
// The board is empty and quiet and the worm is a single segment on a clear row,
// so every step it takes is an unblocked wind and the head's column IS the
// count of steps run.

import { afterEach, beforeEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import { WORM_STEP_L1 } from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  wormById,
  type Harness,
  type WormSnapshot,
} from "../harness";

/** Where the head is posed. Seven steps carry it to column 17, on a clear row. */
const START_C = 10;
const START_R = 5;

/** Intervals of level 1's clock one frame of this check is worth. */
const INTERVALS_PER_FRAME = 3.6;

/** That, in milliseconds: 504 ms, the step this runtime's clock delivers. */
const FRAME_MS = WORM_STEP_L1 * INTERVALS_PER_FRAME * 1000;

/** Steps due by the end of each frame: floor(3.6) and floor(7.2). */
const STEPS_AFTER_FIRST = 3;
const STEPS_AFTER_SECOND = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(FRAME_MS) });
});

afterEach(() => {
  h?.dispose();
});

it("runs every step a long frame covered and carries the remainder", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  let afterFirst: WormSnapshot | undefined;
  let afterSecond: WormSnapshot | undefined;

  await captureReplay(h, "catch-up", async () => {
    await h.advance(1);
    afterFirst = wormById(h.snapshot(), id);
    await h.advance(1);
    afterSecond = wormById(h.snapshot(), id);
  });

  assertDeepEqual(
    afterFirst?.segments,
    [{ c: START_C + STEPS_AFTER_FIRST, r: START_R }],
    `one frame of ${INTERVALS_PER_FRAME} intervals runs ${STEPS_AFTER_FIRST} steps`,
  );
  assertDeepEqual(
    afterSecond?.segments,
    [{ c: START_C + STEPS_AFTER_SECOND, r: START_R }],
    `the remainder carries: ${STEPS_AFTER_SECOND} steps after two such frames`,
  );
});
