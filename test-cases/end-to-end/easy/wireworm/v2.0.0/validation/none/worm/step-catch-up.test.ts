// worm/step-catch-up — one long frame runs every step it covered, and the
// remainder carries into the next frame.
//
// specs/worm.md, "The step clock": "Each time the accumulated time reaches the
// level's step interval, the worm takes one step and the interval is taken off the
// accumulator, so a frame covering several intervals runs several steps in order
// and the remainder carries into the next frame."
//
// THE CLOCK IS THIS CHECK'S OWN. Every other suite in this project steps a 100 Hz
// `ConstantClock`, which cannot express a frame worth three and a half steps. This
// one installs a `SequenceClock` of two deltas instead:
//
//   frame 1  3.5 intervals (0.49 s)  — three whole steps are due inside it
//   frame 2  0.5 intervals + margin  — only the carried remainder can pay for a step
//
// and that is the whole design. The first frame separates a build that runs every
// step a frame covered from one that runs at most one step per frame: the first
// puts the head three tiles on, the second one tile. The second frame separates a
// build that carries the remainder from one that drops it: `0.49` s pays for three
// steps and leaves `0.07` s standing, so a `0.075` s frame reaches `0.145` s and
// steps a fourth time, while a build that zeroed its accumulator holds `0.075` s
// and cannot. Every wrong model therefore reads as a different column.
//
// THE WORLD IS ONE HEAD ON A CLEAR ROW. `startPlaying` leaves the board empty and
// the world gates shut, and the worm is a single segment four tiles clear of
// anything, so nothing can block a step and no body follows.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  requireWorm,
  SequenceClock,
  startPlaying,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** Where the head is posed: a clear row, well inside both side edges. */
const START_C = 10;
const START_R = 5;

/** The level-1 step interval, which is what the harness poses (`WORM_STEP_L1`). */
const INTERVAL = WORM_STEP_L1;

/** Whole steps the long frame covers, and so the tiles the head owes for it. */
const COVERED_STEPS = 3;

/**
 * The long frame, in milliseconds: three and a half intervals, `490` ms.
 *
 * A half interval past the third so the frame leaves a remainder to carry, and
 * short of the fourth so the step count it covers is unambiguous.
 */
const LONG_MS = INTERVAL * 3.5 * 1000;

/**
 * How much past half an interval the second frame runs, in seconds.
 *
 * `0.14` and `0.49` are not exact in binary floating point, so an accumulator that
 * carried the remainder honestly can land a hair under the interval and decline
 * the step the check is looking for. `0.005` s clears that by orders of magnitude
 * while staying a fourteenth of an interval — far inside the `0.07` s that
 * separates a build carrying the remainder from one that dropped it.
 */
const MARGIN = 0.005;

/** The second frame, in milliseconds: half an interval and the margin, `75` ms. */
const SHORT_MS = (INTERVAL * 0.5 + MARGIN) * 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new SequenceClock([LONG_MS, SHORT_MS]) });
});

afterEach(async () => {
  await h?.dispose();
});

it("runs the three steps one long frame covered and carries the remainder", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, { c: START_C, r: START_R, length: 1 });

  const read = await captureReplay(
    h,
    "catch-up",
    async (): Promise<{ long: WirewormSnapshot; short: WirewormSnapshot }> => {
      await h.advance(1);
      const long = await h.snapshot();
      await h.advance(1);
      return { long, short: await h.snapshot() };
    },
  );

  assertDeepEqual(
    requireWorm(read.long, id, "the long frame").segments,
    [{ c: START_C + COVERED_STEPS, r: START_R }],
    `after one frame worth ${INTERVAL * 3.5} s: the head ${COVERED_STEPS} tiles on`,
  );
  assertDeepEqual(
    requireWorm(read.short, id, "the frame after the long one").segments,
    [{ c: START_C + COVERED_STEPS + 1, r: START_R }],
    `after a following frame worth ${INTERVAL * 0.5 + MARGIN} s: one further tile ` +
      "on, which only the remainder the long frame carried can pay for",
  );
});
