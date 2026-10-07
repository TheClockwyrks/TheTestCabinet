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
//
// AND THE RECORDING BRACKETS THE PAIR RATHER THAN BEING THE PAIR. Two frames are
// not something a reviewer can watch — a player opened on them shows a still —
// so the same `SequenceClock` carries a run-up before the long frame and a
// settle after the short one, of frames far too short to fall due: ten and then
// twenty frames of `QUIET_MS`, `36` ms of game time all told against a `140` ms
// interval. The two readings are still taken on the same two frames, so the
// verdict is untouched; what changes is that the reviewer sees the board at rest,
// then the head jump three tiles, then take its fourth, then run on.
//
// THE RUN-UP'S TIME ENTERS THE LONG FRAME, so the margins are restated with it
// included. The accumulator holds `12` ms when the long frame opens, so that
// frame reaches `502` ms: still three steps, and `58` ms clear of the fourth at
// `560`. It leaves `82` ms standing, so the short frame reaches `157` ms and
// takes the fourth step, while a build that dropped the remainder reaches `75` ms
// and cannot — the same `65` ms of daylight the check had before. The settle
// then adds `24` ms to the `17` ms left over, which is `99` ms short of a fifth
// step, so nothing lands inside it.

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

/**
 * A frame of the run-up and the settle, in milliseconds.
 *
 * Short enough that a run of them cannot pay for a step: thirty frames of it is
 * `36` ms against the `140` ms interval, so every step this check reads is one
 * of the two frames it is about.
 */
const QUIET_MS = 1.2;

/** Frames of run-up: the board at rest, before the long frame lands. */
const RUN_UP_FRAMES = 10;

/** Frames of settle: what the two frames left behind. */
const SETTLE_FRAMES = 20;

/**
 * The whole frame script, in order, which is exactly what the drive consumes.
 *
 * `SequenceClock` cycles its deltas, so the drive below runs
 * `RUN_UP_FRAMES + 2 + SETTLE_FRAMES` frames against a script of that length and
 * never wraps.
 */
const SCRIPT = [
  ...Array<number>(RUN_UP_FRAMES).fill(QUIET_MS),
  LONG_MS,
  SHORT_MS,
  ...Array<number>(SETTLE_FRAMES).fill(QUIET_MS),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new SequenceClock(SCRIPT) });
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
      await h.advance(RUN_UP_FRAMES);
      await h.advance(1);
      const long = await h.snapshot();
      await h.advance(1);
      const short = await h.snapshot();
      await h.advance(SETTLE_FRAMES);
      return { long, short };
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
