// progression/level-banner — the next level opens on its banner, for BANNER_TIME.
//
// THE RULE. `specs/progression.md`, *Clearing a level*, step 4: *the phase becomes
// `banner`, with its timer at `BANNER_TIME`*, and, from *The three phases of
// play*: *when the `banner` phase's timer runs out, the phase becomes `active`*.
// `BANNER_TIME` is `1.3` s.
//
// THE BANNER IS MEASURED, NOT SAMPLED. A check that advanced `BANNER_TIME` and
// found `active` would pass a build whose banner lasted a single frame, so the
// transition is timed: the phase the clear left the run in is read, then the
// frames between that and the phase becoming `active` are counted and the seconds
// they cover are held against `1.3`. The `none` and `structured-2d` suites take
// the same reading against the same tolerance.
//
// The clear is driven by a real shot into a motionless one-segment worm, exactly
// as `progression/level-clears-on-last-segment` drives it, because the banner this
// point is about is the one a CLEAR opens. The worm-entry gate stays off, so the
// banner gives way to an empty board and the phase is the only thing that changes.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillWorm, shootUpAt } from "./scenario";

/** The level cleared, and where its lone segment stands. */
const LEVEL = 2;
const WORM_COL = 20;
const WORM_ROW = 8;

/**
 * The ceiling on the sweep that waits for the shot to land, in frames. One second,
 * against a bolt at `BOLT_SPEED` (`900` units per second) posed three tiles below
 * its target (`specs/cursor.md`).
 */
const SHOT_FRAMES = ticksFor(1);

/**
 * How far the measured banner may be from `BANNER_TIME`, in seconds.
 *
 * `0.05` s. The clear lands on one frame boundary and the transition is read on
 * another, so the reading is quantized by a couple of frames however exactly a
 * build counts; `0.05` s is well above that and a twenty-sixth of the `1.3` s it
 * is checking, so a build whose banner is a frame long, or twice the stated
 * length, is nowhere near it. The `none` and `structured-2d` suites read the same
 * figure.
 */
const BANNER_TOLERANCE = 0.05;

/**
 * How long past `BANNER_TIME` the banner is given to end, in seconds. Half a
 * second, so a build that overruns is measured and failed on the figure rather
 * than left un-decided by a sweep that stopped too soon.
 */
const BANNER_GRACE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens the next level on its banner and gives way BANNER_TIME later", async () => {
  startPlaying(harness);
  harness.debug.setLevel(LEVEL);
  poseStillWorm(harness, WORM_COL, WORM_ROW);
  shootUpAt(harness, WORM_COL, WORM_ROW);

  await harness.until((s) => s.worms.length === 0, { maxFrames: SHOT_FRAMES });
  assertEqual(
    harness.snapshot().phase,
    "banner",
    "the phase the clear leaves the run in",
  );

  // The frame that draws the banner, which is also the picture kept. It is one
  // frame OF the banner, so it is counted in the elapsed time below.
  await harness.advance(1);
  captureStill(harness, "banner");

  const active = await harness.until((s) => s.phase === "active", {
    maxFrames: ticksFor(BANNER_TIME + BANNER_GRACE),
  });
  assertEqual(
    active.hit,
    true,
    `the banner giving way to active play within ` +
      `${BANNER_TIME + BANNER_GRACE} s`,
  );

  // One frame for the render above, plus the frames the sweep ran before the
  // sample that found `active`.
  assertBetween(
    seconds(1 + active.frames),
    BANNER_TIME - BANNER_TOLERANCE,
    BANNER_TIME + BANNER_TOLERANCE,
    "the seconds the level's banner lasted",
  );
});
