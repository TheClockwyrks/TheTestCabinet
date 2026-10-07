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
//
// AND THE RECORDING BRACKETS THE PAIR RATHER THAN BEING THE PAIR. Two frames are
// not something a reviewer can watch — a player opened on them shows a still —
// so the clock is one whose next delta this check sets rather than a constant,
// and it carries a run-up before the first long frame and a settle after the
// second: ten and then twenty frames of `QUIET_INTERVALS`, three tenths of one
// interval all told. The two readings are still taken on the same two long
// frames, so the verdict is untouched.
//
// THE RUN-UP'S TIME ENTERS THE FIRST LONG FRAME, so the two readings are
// restated with it included: `0.1 + 3.6 = 3.7` still floors to 3, and
// `0.1 + 7.2 = 7.3` still floors to 7. The nearest boundary is `0.3` of an
// interval away in each case, where it was `0.4` and `0.2` before, so both
// readings sit further from a rounding of the accumulator than one of them did.
// The settle then adds `0.2` to the `0.3` left standing, half an interval in
// all, so no stray step lands inside it.

import { afterEach, beforeEach, it } from "vitest";
import type { Clock } from "@clockwyrks/structured-2d";
import { WORM_STEP_L1 } from "../constants";
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

/**
 * One frame of the run-up and the settle, in step intervals.
 *
 * A hundredth of an interval, so the thirty of them this check runs come to three
 * tenths of one and no step can fall due inside either bracket: every step the
 * check counts belongs to one of the two long frames.
 */
const QUIET_INTERVALS = 0.01;

/** That, in milliseconds: `1.4` ms. */
const QUIET_MS = WORM_STEP_L1 * QUIET_INTERVALS * 1000;

/** Frames of run-up: the board at rest, before the first long frame lands. */
const RUN_UP_FRAMES = 10;

/** Frames of settle: what the two long frames left behind. */
const SETTLE_FRAMES = 20;

/** A clock whose next delta the check sets, so one frame can be any length. */
class ScriptedClock implements Clock {
  stepMs = FRAME_MS;

  delta(): number {
    return this.stepMs;
  }
}

let clock: ScriptedClock;
let h: Harness;

beforeEach(async () => {
  clock = new ScriptedClock();
  h = await createHarness({ clock });
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
    clock.stepMs = QUIET_MS;
    await h.advance(RUN_UP_FRAMES);
    clock.stepMs = FRAME_MS;
    await h.advance(1);
    afterFirst = wormById(h.snapshot(), id);
    await h.advance(1);
    afterSecond = wormById(h.snapshot(), id);
    clock.stepMs = QUIET_MS;
    await h.advance(SETTLE_FRAMES);
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
