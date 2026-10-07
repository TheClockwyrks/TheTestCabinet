// progression/timer-length-level-1 — a crossing on the first level is given thirty
// seconds.
//
// specs/progression.md: "`timerMax` is the seconds a crossing at the current level
// gets: `crossingTimer(level) = max(TIMER_MIN, TIMER_BASE - (level - 1) *
// TIMER_PER_LEVEL)` ... so a level-1 crossing gets `30` s". It also fixes what a
// fresh crossing starts from: "The crossing timer goes back to `timerMax`."
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS IT, from the reset title by confirming
// `CROSS`, and not posed. A pose cannot decide this point: `setTimer` writes
// whatever number it is handed and `setLevel` lays a strait out without starting
// anything (specs/instrumentation.md), so the reading has to be what the build's
// own opening of a run produced. The screen is read first, as the situation rather
// than the requirement, so a build whose menu never started a run fails here rather
// than being read for a clock it never set.
//
// BOTH NUMBERS ARE READ, AND THEY ARE READ DIFFERENTLY. `timerMax` is derived from
// the level and nothing drains it, so it is read as an equality. `timer` is a
// running clock and the four world gates are back on after `reset`, so by the time
// the reading is taken the drain has had the handful of frames it took to deliver
// the key and draw a picture. `DRAIN_TOLERANCE` is exactly that handful, and the
// window is one-sided: a clock may be a few ticks BELOW thirty seconds, and may
// never be above it.
//
// The formula across every level is `progression/timer-shortens`; this point is the
// one worked value the specification states in full.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, TIMER_BASE } from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The level a run opens on (specs/progression.md). */
const LEVEL = 1;

/** One frame after the run opens, so the still shows the crossing it opened. */
const SETTLE_FRAMES = 1;

/**
 * How far below `TIMER_BASE` the clock may read.
 *
 * Six ticks — a twentieth of a second at the `TICK_HZ` (`120`) specs/overview.md
 * fixes. Opening the run costs the frame that delivers the key, and the still below
 * costs one more; six is that handful with room to spare, and it is far short of
 * the two seconds a level would have to be wrong by to read as another level's
 * figure.
 */
const DRAIN_TOLERANCE = 6 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens a level-1 crossing on a thirty-second timer", async () => {
  await startRun(h);
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "start");

  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "the title menu's first item starts a run (specs/ui.md)",
  );
  assertEqual(opened.level, LEVEL, "the level a run opens on");
  assertEqual(
    opened.timerMax,
    TIMER_BASE,
    "the seconds a level-1 crossing gets (specs/progression.md)",
  );
  assertBetween(
    opened.timer,
    TIMER_BASE - DRAIN_TOLERANCE,
    TIMER_BASE,
    "a fresh crossing's clock, standing at its full length",
  );
});
