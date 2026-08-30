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
// WHAT IS MEASURED. The frames of the harness's own 120 Hz clock the head takes to
// advance ten tiles, held against the 168 frames `1.4` s is worth. TEN steps
// rather than one because a single step read a frame early or late is still within
// 6% of the figure, where over ten the same frame of slack is 0.6% — so the
// reading separates `0.14` s from any neighbouring interval a build might have
// picked. The head is also read for its EXACT tile, so a build that took eleven
// steps in the time ten were due fails here rather than passing on the frame count.
//
// THE WORLD IS ONE HEAD ON A CLEAR ROW. `startPlaying` leaves the board empty and
// the world gates shut, and the worm is a single segment, so nothing but the step
// clock can decide when the head arrives.

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
  wormOf,
  type Harness,
} from "../harness";

/** Where the head is posed. Ten steps carry it to column 15, on a clear row. */
const START_C = 5;
const START_R = 5;

/** Steps timed. */
const STEPS = 10;

/**
 * The frames ten steps are due in: `10 * 0.14` s of game time on the harness's
 * 120 Hz clock, which is 168 frames.
 */
const DUE_FRAMES = ticksFor(WORM_STEP_L1 * STEPS);

/**
 * How far the count may fall from that, in frames.
 *
 * A step lands in the frame whose accumulated time FIRST reaches the interval, so
 * an arrival can be read up to one frame late; and 168 additions of `1 / 120` s
 * settle a hair either side of `1.4` s in binary floating point, which can move
 * that frame by one more. Two frames is `2 / 120` s, 1.2% of the `1.4` s figure —
 * far inside the gap to any neighbouring interval, since `0.13` s would land ten
 * steps at 156 frames and `0.15` s at 180.
 */
const TOLERANCE_FRAMES = 2;

/** How far the sweep runs: twice the figure, so a slow build is still measured. */
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
      const worm = s.worms.find((held) => held.id === id);
      return worm !== undefined && worm.segments[0].c >= START_C + STEPS;
    },
    { maxFrames: MAX_FRAMES, poll: 1 },
  );

  captureStill(h, "cadence");

  assertEqual(
    swept.hit,
    true,
    `the head to reach column ${START_C + STEPS} within ${MAX_FRAMES} frames`,
  );
  // Exactly ten tiles on, so a build that overshot the count fails here as well.
  assertDeepEqual(
    wormOf(swept.snapshot, id).segments,
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
