// worm/step-cadence — at level 1 the worm takes one step per 0.14 s of game time.
//
// specs/worm.md, "The step clock": "Each worm carries its own step clock, which
// accumulates the simulated time that passes. Each time the accumulated time
// reaches the level's step interval, the worm takes one step". The interval is
//
//   wormStepInterval(level) = max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
//
// which at level 1 is `WORM_STEP_L1` itself, `0.14` s. The clock "starts at zero
// when the worm comes into existence", and specs/instrumentation.md has `addWorm`
// start it at the call, so the tenth step is due exactly `10 * 0.14 = 1.4` s of
// game time after the worm is posed.
//
// WHAT IS MEASURED. The frames of the harness's own 100 Hz clock the head takes to
// advance ten tiles, held against the 140 frames `1.4` s is worth. TEN steps
// rather than one because a single step read a frame early or late is still within
// 7% of the figure, where over ten the same frame of slack is 0.7% — so the
// reading separates `0.14` s from any neighbouring interval a build might have
// picked. The head is also read for its EXACT tile, so a build that took eleven
// steps in the time ten were due fails here rather than passing on the frame count.
//
// THE WORLD IS ONE HEAD ON A CLEAR ROW. `startPlaying` leaves the board empty and
// the world gates shut, and the worm is a single segment, so nothing but the step
// clock can decide when the head arrives.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertBetween, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  requireWorm,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** Where the head is posed. Ten steps carry it to column 15, on a clear row. */
const START_C = 5;
const START_R = 5;

/** Steps timed. */
const STEPS = 10;

/**
 * The frames ten steps are due in: `10 * 0.14` s of game time on the harness's
 * 100 Hz clock, which is 140 frames.
 */
const DUE_FRAMES = framesFor(WORM_STEP_L1 * STEPS);

/**
 * How far the count may fall from that, in frames.
 *
 * Three, and each of them is a reading artefact rather than room on the figure. A
 * step lands in the frame whose accumulated time FIRST reaches the interval, and
 * the sweep reads between frames, so an arrival can be read one frame late. The
 * interval is a WHOLE number of this harness's frames — `0.14` s is exactly 14 at
 * 100 Hz — so the boundary falls exactly on a frame, where neither `0.01` s nor
 * `0.14` s is exact in binary floating point and the sum can settle a hair either
 * side; that is one frame more, and a build that adds its deltas in a different
 * order can land a frame either side of that in turn. Three frames is `0.03` s,
 * 2.1% of the `1.4` s figure, and far inside the gap to any neighbouring interval:
 * `0.13` s would land ten steps at 130 frames and `0.15` s at 150.
 */
const TOLERANCE_FRAMES = 3;

/** How far the sweep runs: twice the figure, so a slow build is still measured. */
const MAX_FRAMES = DUE_FRAMES * 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes exactly one step per 0.14 s of game time at level 1", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, { c: START_C, r: START_R, length: 1 });

  const swept = await h.until(
    (s) => {
      const worm = s.worms.find((held) => held.id === id);
      return worm !== undefined && worm.segments[0].c >= START_C + STEPS;
    },
    { maxFrames: MAX_FRAMES, poll: 1 },
  );

  await captureStill(h, "cadence");

  assertEqual(
    swept.hit,
    true,
    `the head to reach column ${START_C + STEPS} within ${MAX_FRAMES} frames`,
  );
  // Exactly ten tiles on, so a build that overshot the count fails here as well.
  assertDeepEqual(
    requireWorm(swept.snapshot, id, "the timed run of ten steps").segments,
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
