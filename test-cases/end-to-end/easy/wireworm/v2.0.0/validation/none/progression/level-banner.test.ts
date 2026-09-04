// progression/level-banner — the next level opens behind its banner.
//
// `specs/progression.md`, Clearing a level, step 4: "The phase becomes `banner`,
// with its timer at `BANNER_TIME`, and the next level's worm enters when that
// timer runs out." The phase table gives `BANNER_TIME` as `1.3` s and says what
// the phase is: "The level's banner is shown over the board before play begins."
// And, under The three phases of play: "When the `banner` phase's timer runs out,
// the phase becomes `active`."
//
// THE BANNER IS MEASURED, NOT SAMPLED. A check that advanced `BANNER_TIME` and
// found `active` would pass a build whose banner lasted a single frame, so the
// transition is timed: the frames between the clear and the phase becoming
// `active` are counted, and the seconds they cover are held against `1.3`. The
// `none`, `simple-2d` and `structured-2d` suites take the same reading against
// the same tolerance.
//
// The board is left empty behind the banner: `startPlaying` shuts the worm-entry
// gate, so the next level's own worm does not enter and nothing but the phase
// timer is running.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import { BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";
import { cutLastSegment } from "./run";

/** The level cleared, so the banner read is the one the NEXT level opens on. */
const LEVEL = 2;

/**
 * How far the measured banner may be from `BANNER_TIME`, in seconds.
 *
 * `0.05` s. The clear lands on one frame boundary and the transition is read on
 * another, so the reading is quantized by a couple of frames however exactly a
 * build counts; `0.05` s is well above that and a twenty-sixth of the `1.3` s it
 * is checking, so a build whose banner is a frame long, or twice the stated
 * length, is nowhere near it. The `none`, `simple-2d` and `structured-2d` suites
 * read the same figure.
 */
const BANNER_TOLERANCE = 0.05;

/**
 * How long past `BANNER_TIME` the banner is given to end, in seconds. Half a
 * second, so a build that overruns is measured and failed on the figure rather
 * than left un-decided by a sweep that stopped too soon.
 */
const BANNER_GRACE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens the next level on a banner that gives way after 1.3s", async () => {
  await startPlaying(h, { level: LEVEL });

  await cutLastSegment(h);

  await captureStill(h, "banner");
  const cleared = await h.snapshot();
  assertLength(
    cleared.worms,
    0,
    "precondition: the bolt removed the last segment (specs/worm.md)",
  );
  assertEqual(cleared.phase, "banner", "the phase the clear left");

  const active = await h.until((snapshot) => snapshot.phase === "active", {
    maxFrames: framesFor(BANNER_TIME + BANNER_GRACE),
  });
  assertEqual(
    active.hit,
    true,
    `the banner giving way to active play within ` +
      `${BANNER_TIME + BANNER_GRACE} s`,
  );

  assertBetween(
    seconds(active.frames),
    BANNER_TIME - BANNER_TOLERANCE,
    BANNER_TIME + BANNER_TOLERANCE,
    "the seconds the level's banner lasted",
  );
});
