// progression/timer-shortens — every level's crossing timer is the length the
// formula gives it, floor included.
//
// specs/progression.md: "`timerMax` is the seconds a crossing at the current level
// gets: `crossingTimer(level) = max(TIMER_MIN, TIMER_BASE - (level - 1) *
// TIMER_PER_LEVEL)` ... `TIMER_BASE` is `30`, `TIMER_PER_LEVEL` is `2`, and
// `TIMER_MIN` is `15`, so a level-1 crossing gets `30` s and a level-8 crossing
// gets `16` s."
//
// ALL EIGHT LEVELS ARE READ, AND THE WHOLE FORMULA WITH THEM. Reading two would
// leave a build that got the STEP wrong indistinguishable from one that got the
// base wrong, and a build with the right step and the wrong floor — the floor never
// bites below level `8`, since `30 - 7 * 2` is `16` and `16 > 15` — would pass on
// any pair. Each level names itself in the failure, so a build that is wrong at one
// level is named at that level.
//
// `timerMax` IS WHAT IS READ, AND NOT `timer`. The specification derives `timerMax`
// from the level alone (specs/instrumentation.md lists it among the fields built at
// the call), while `timer` is the running clock a crossing spends and `setLevel`
// leaves it exactly as it stands. So this point poses the level and reads the length
// the level gives; that a fresh crossing STARTS at that length is
// `progression/timer-length-level-1` and `progression/timer-resets-on-bay`.
//
// THE ROSTERS ARE RE-CLEARED AFTER EVERY `setLevel`. Setting a level re-lays the
// sixteen lanes by design (specs/instrumentation.md), so each step of the loop would
// otherwise leave a level's worth of traffic on a strait the check had emptied.
// Nothing here reads the strait, but a check that leaves traffic running under it is
// a check that can be caught out by it.
//
// The still is the LAST of the eight, level `8`, since a picture can only hold one:
// it is the level whose figure the specification works out in full, and it is the
// one a build that dropped below the floor would show wrong.

import { afterEach, beforeEach, it } from "vitest";
import { TIMER_MIN, TOTAL_LEVELS, crossingTimer } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The levels a run is, read in order (specs/progression.md). */
const LEVELS = Array.from({ length: TOTAL_LEVELS }, (_, index) => index + 1);

/** One frame, so the still shows the last level's strait rather than a blank. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives every level the crossing timer the formula gives it", async () => {
  startCrossing(h, LEVELS[0]);

  for (const level of LEVELS) {
    h.debug.setLevel(level);
    h.debug.clearVehicles();
    h.debug.clearFloes();

    const posed = h.snapshot();
    assertEqual(posed.level, level, "the level the strait was laid out for");
    assertEqual(
      posed.timerMax,
      crossingTimer(level),
      `max(${TIMER_MIN}, 30 - (${level} - 1) * 2) at level ${level}`,
    );
  }

  await h.advance(SETTLE_FRAMES);
  captureStill(h, "levels");
});
