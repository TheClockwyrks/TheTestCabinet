// worm/step-cadence — at level 1 the worm takes one step per 0.14 s.
//
// specs/worm.md, The step clock: a worm carries its own step clock, which
// accumulates the simulated time that passes, and takes one step each time the
// accumulated time reaches the level's interval. The interval is
//
//   wormStepInterval(level) = max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
//
// which at level 1 is `WORM_STEP_L1` itself, `0.14` s. The clock "starts at
// zero when the worm comes into existence", and `addWorm` starts it at the call
// (specs/instrumentation.md), so the tenth step is due exactly
// `10 * 0.14 = 1.4` s of game time after the worm is posed.
//
// WHAT IS MEASURED, AND WHY TEN STEPS. The drive counts FRAMES of the harness's
// own 120 Hz clock until the head has advanced ten tiles, and compares that
// count against the 168 frames 1.4 s is worth. Ten steps rather than one
// because a single step could be read a whole frame early or late and still be
// within 6% of the figure; over ten the same frame of slack is 0.6%, so the
// reading separates `0.14` from any neighbouring interval a build might have
// picked. The head is also read for its EXACT tile, so a build that took eleven
// steps in the time ten were due fails here rather than passing on the count.
//
// The board is empty and quiet and the worm is a single segment on a clear row,
// so nothing but the clock can decide when the head arrives.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../../src/constants";
import { assertBetween, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  TICK_HZ,
  ticksFor,
  wormById,
  type Harness,
} from "../harness";

/** Where the head is posed. Ten steps carry it to column 15, on a clear row. */
const START_C = 5;
const START_R = 5;

/** Steps timed. */
const STEPS = 10;

/**
 * The frames ten steps are due in: `10 * 0.14` s of game time on a 120 Hz
 * clock, which is 168 frames.
 */
const DUE_FRAMES = ticksFor(WORM_STEP_L1 * STEPS);

/**
 * How far the count may fall from that.
 *
 * `0.03` s, stated in SECONDS and converted to this harness's own frames, so
 * every engine's suite allows the same drift on the same cadence requirement.
 * Each part of it is a reading artefact rather than room on the figure: a step
 * lands in the frame whose accumulated time FIRST reaches the interval and the
 * sweep reads between frames, so an arrival can be read a frame late; and the
 * accumulated deltas settle a hair either side of `1.4` s in binary floating
 * point, which can move that frame by one more, and a build that adds its deltas
 * in a different order can land a frame either side of that in turn. `0.03` s is
 * 2.1% of the `1.4` s figure and far inside the gap to any neighbouring interval:
 * a build stepping every `0.13` s reaches ten steps `0.1` s early and one
 * stepping every `0.15` s `0.1` s late.
 */
const TOLERANCE_SECONDS = 0.03;
const TOLERANCE_FRAMES = ticksFor(TOLERANCE_SECONDS);

/** How far the sweep may run: twice the figure, so a slow build is measured. */
const MAX_FRAMES = DUE_FRAMES * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes exactly one step per 0.14 s of game time at level 1", async () => {
  startPlaying(h);
  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const swept = await h.until(
    (s) => {
      const head = wormById(s, id)?.segments[0];
      return head !== undefined && head.c >= START_C + STEPS;
    },
    { maxFrames: MAX_FRAMES, poll: 1 },
  );

  captureStill(h, "cadence");

  assertEqual(
    swept.hit,
    true,
    `the head to reach column ${START_C + STEPS} within ${MAX_FRAMES} frames`,
  );
  // Exactly ten tiles on, so a build that overshot the count fails here too.
  assertDeepEqual(
    wormById(swept.snapshot, id)?.segments,
    [{ c: START_C + STEPS, r: START_R }],
    `the head ${STEPS} tiles on, holding its row`,
  );
  assertBetween(
    swept.frames,
    DUE_FRAMES - TOLERANCE_FRAMES,
    DUE_FRAMES + TOLERANCE_FRAMES,
    `frames of the ${TICK_HZ} Hz clock covering ${STEPS} steps ` +
      `(${WORM_STEP_L1 * STEPS} s of game time)`,
  );
});
