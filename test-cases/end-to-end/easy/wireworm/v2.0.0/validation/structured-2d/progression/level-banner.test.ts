// progression/level-banner — the level a clear opens starts on its banner, and
// the banner lasts BANNER_TIME.
//
// specs/progression.md: on a clear the phase becomes `banner`, with its timer at
// `BANNER_TIME` (`1.3` s), and the banner phase's timer counts down against the
// delta time of each update — when it runs out the phase becomes `active`. So
// there are two readings here, and they are one rule: the phase the clear leaves
// the run in, and how long that phase lasts.
//
// THE BANNER IS MEASURED, NOT SAMPLED. A check that advanced `BANNER_TIME` and
// found `active` would pass a build whose banner lasted a single frame, so the
// transition is timed: the frames between the clear and the phase becoming
// `active` are counted, and the seconds they cover are held against `1.3`.
//
// The worm the banner gives way to is not read here — `wormEntry` is off, and a
// worm entering as a banner ends is `respawn-spawns-worm`'s and `worm.enters-
// top-row`'s point. What the level counted up to is `level-advances`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  ticksFor,
  type Harness,
} from "../harness";
import { clearLastSegment } from "./clear";

/** The level cleared: well below `TOTAL_LEVELS`, so a banner follows the clear. */
const LEVEL = 3;

/**
 * How far the measured banner may be from `BANNER_TIME`, in seconds.
 *
 * `0.05` s — six frames of the harness's 120 Hz clock. The clear lands on one
 * frame boundary and the transition is read on another, so the reading is
 * quantized by a couple of frames however exactly a build counts; `0.05` s is
 * well above that and a twenty-sixth of the `1.3` s it is checking, so a build
 * whose banner is a frame long, or twice the stated length, is nowhere near it.
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

afterEach(() => {
  h?.dispose();
});

it("opens the next level on a banner lasting BANNER_TIME", async () => {
  const cleared = await clearLastSegment(h, LEVEL);
  assertEqual(cleared.phase, "banner", "the phase the clear leaves the run in");

  // The frame that draws the banner, which is also the picture kept. It is one
  // frame OF the banner, so it is counted in the elapsed time below.
  await h.advance(1);
  captureStill(h, "banner");

  const active = await h.until((snapshot) => snapshot.phase === "active", {
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
  const banner = seconds(1 + active.frames);
  assertBetween(
    banner,
    BANNER_TIME - BANNER_TOLERANCE,
    BANNER_TIME + BANNER_TOLERANCE,
    "the seconds the level's banner lasted",
  );
});
