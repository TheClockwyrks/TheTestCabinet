// worm/step-catch-up — one long frame runs every step it covered, and the
// remainder carries into the next frame.
//
// specs/worm.md, "The step clock": "Each time the accumulated time reaches the
// level's step interval, the worm takes one step and the interval is taken off the
// accumulator, so a frame covering several intervals runs several steps in order
// and the remainder carries into the next frame."
//
// THE CLOCK IS THIS CHECK'S OWN. Every other suite in this project steps the
// harness's 120 Hz `ConstantClock`, which cannot express a frame worth three and a
// half steps. This one installs a clock whose next delta it sets, and runs exactly
// two frames through it:
//
//   frame 1  3.5 intervals  — three whole steps are due inside it
//   frame 2  0.55 intervals — only the carried remainder can pay for a step
//
// and that is the whole design. The first frame separates a build that runs every
// step a frame covered from one that runs at most one step per frame: the first
// puts the head three tiles on, the second one tile. The second frame separates a
// build that carries the remainder from one that drops it: the long frame pays for
// three steps and leaves half an interval standing, so a frame worth `0.55` of one
// reaches `1.05` intervals and steps a fourth time, while a build that zeroed its
// accumulator holds `0.55` and cannot. Every wrong model reads as a different
// column.
//
// THE FRAMES ARE SIZED FROM THE INTERVAL IN FORCE, NOT FROM `0.14` s. The rule is
// written against "the level's step interval", and a frame stated in absolute
// seconds would secretly demand a particular cadence: a build whose interval is
// wrong would fail here as well as at `worm.step-cadence` and
// `worm.step-quickens`, which are the two points that own it. So the check reads
// `wormStepInterval` off the snapshot — the figure the build itself says it is
// clocking on — and measures its frames in multiples of that.
//
// THE WORLD IS ONE HEAD ON A CLEAR ROW. `startPlaying` leaves the board empty and
// the world gates shut, and the worm is a single segment four tiles clear of
// anything, so nothing can block a step and no body follows.

import { afterEach, beforeEach, it } from "vitest";
import type { Clock } from "@test-cabinet/simple-2d";
import { assertDeepEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  poseWorm,
  startPlaying,
  TICK_MS,
  wormOf,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** Where the head is posed: a clear row, well inside both side edges. */
const START_C = 10;
const START_R = 5;

/** Whole steps the long frame covers, and so the tiles the head owes for it. */
const COVERED_STEPS = 3;

/** The long frame, in step intervals: three whole steps and a half left over. */
const LONG_INTERVALS = COVERED_STEPS + 0.5;

/**
 * The second frame, in step intervals.
 *
 * Half an interval is what the long frame left standing, so `0.55` is that half
 * plus a twentieth of an interval — `0.007` s at level 1. The margin exists only
 * so binary rounding of the intervals cannot decide the reading; it is fourteen
 * orders of magnitude past double-precision error and still nowhere near the half
 * interval that separates a build carrying the remainder from one that dropped it.
 */
const SHORT_INTERVALS = 0.55;

/** A clock whose next delta the check sets, so one frame can be any length. */
class ScriptedClock implements Clock {
  stepMs = TICK_MS;

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

it("runs the three steps one long frame covered and carries the remainder", async () => {
  startPlaying(h);
  const interval = h.snapshot().wormStepInterval;
  assertGreaterThan(
    interval,
    0,
    "the wormStepInterval the snapshot reports at level 1, which this check " +
      "measures its two frames in multiples of (specs/instrumentation.md)",
  );

  const id = poseWorm(h, START_C, START_R, 1, 1, 1);

  const read = await captureReplay(
    h,
    "catch-up",
    async (): Promise<{ long: WirewormSnapshot; short: WirewormSnapshot }> => {
      clock.stepMs = interval * LONG_INTERVALS * 1000;
      await h.advance(1);
      const long = h.snapshot();
      clock.stepMs = interval * SHORT_INTERVALS * 1000;
      await h.advance(1);
      return { long, short: h.snapshot() };
    },
  );

  assertDeepEqual(
    wormOf(read.long, id).segments,
    [{ c: START_C + COVERED_STEPS, r: START_R }],
    `after one frame worth ${LONG_INTERVALS} step intervals: the head ` +
      `${COVERED_STEPS} tiles on`,
  );
  assertDeepEqual(
    wormOf(read.short, id).segments,
    [{ c: START_C + COVERED_STEPS + 1, r: START_R }],
    `after a following frame worth ${SHORT_INTERVALS} of an interval: one ` +
      "further tile on, which only the remainder the long frame carried can pay for",
  );
});
