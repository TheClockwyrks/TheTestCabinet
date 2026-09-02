// progression/timer-costs-life — the crossing timer reaching zero costs the run
// exactly one life, on the tick it reaches it.
//
// specs/progression.md: "`timer` counts down while `phase` is `crossing` and no
// hold is running. On the tick it reaches `0` the critter loses a life." And it
// lists the timer among the five costs, each of which "`lives` drops by exactly
// one, `phase` becomes `dying`".
//
// `setTimerRunning(true)` is the one gate this point turns back on, because the
// timer's drain IS its requirement. Every other check in this suite leaves it off
// precisely so that this one is the only place a crossing can time out.
//
// THE CLOCK IS POSED SHORT AND THE READING IS TAKEN TWICE. `setTimer` "kills
// nothing, so `setTimer(0)` is a precondition and the next tick of a running timer
// is what costs the life" (specs/instrumentation.md), so half a second is posed and
// the drain is left to run it out. `MID` reads the crossing four fifths of the way
// through that half second: a build that took the life the moment the gate was
// opened, or the moment the timer was posed, is already dying there and fails.
// `DRIVE` then reads it past the end.
//
// NOTHING ELSE ON THE STRAIT CAN COST THE LIFE. `startCrossing` empties the four
// rosters and leaves the critter on the near shore, which is solid footing
// (specs/strait.md), so the clock is the only one of the five costs in play.
//
// WHY THE CLOCK IS READ WITH A CEILING RATHER THAN AN EQUALITY. A tick is `1/120` s
// and specs/progression.md says the life goes on the tick the clock reaches `0` —
// but a clock summed tick by tick in binary lands a hair either side of the figure,
// and a build is free to hold the reading at `0` or to leave the fraction it
// overshot by. `TIMER_FLOOR` is one tick's worth, which is the most either model
// can be away from zero, and the check reads "at most" so both pass and a clock
// that never drained does not.
//
// The delta is read rather than the absolute, so a build that mis-posed the counter
// fails the point that owns the counter rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds the crossing timer is posed with. */
const POSED_TIMER = 0.5;

/**
 * The two readings, in frames.
 *
 * `MID` is four fifths of the posed half second, where a drain that has behaved
 * still has a tenth of a second left; `DRIVE` carries the rest of it, plus
 * `TOLERANCE_FRAMES`.
 */
const MID = ticksFor(0.4);
const DRIVE = ticksFor(POSED_TIMER) - MID;

/**
 * Two frames of room past the boundary.
 *
 * Sixty subtractions of a hundred-and-twentieth do not land exactly on the half
 * second they were meant to reach, and a build is free to test its clock before
 * subtracting the tick rather than after; either costs it at most one tick.
 */
const TOLERANCE_FRAMES = 2;

/** How far from `0` a drained clock may read: one tick's worth. */
const TIMER_FLOOR = TICK_DT;

/** Frames of the hold recorded after the reading, for the replay alone. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes one life and starts the dying hold on the tick the crossing timer reaches zero", async () => {
  startCrossing(h);
  h.debug.setTimer(POSED_TIMER);
  h.debug.setTimerRunning(true);

  const before = h.snapshot();
  assertEqual(
    before.phase,
    "crossing",
    "a live crossing before the clock runs out",
  );
  assertEqual(
    before.timer,
    POSED_TIMER,
    "the clock the crossing was posed with",
  );

  const { running, expired } = await captureReplay(h, "expire", async () => {
    await h.advance(MID);
    const partway = h.snapshot();
    await h.advance(DRIVE + TOLERANCE_FRAMES);
    const out = h.snapshot();
    await h.advance(AFTER_FRAMES);
    return { running: partway, expired: out };
  });

  // The situation the reading was taken in: four fifths of the way through, the
  // clock has drained and the crossing is still alive.
  assertEqual(
    running.phase,
    "crossing",
    "still crossing while the clock still reads",
  );
  assertGreaterThan(
    running.timer,
    0,
    "a clock still above zero four fifths in",
  );
  assertEqual(running.lives, before.lives, "a running clock costs no life");

  assertLessThanOrEqual(
    expired.timer,
    TIMER_FLOOR,
    "a crossing timer drained to zero (specs/progression.md)",
  );
  assertEqual(
    before.lives - expired.lives,
    1,
    "the one life the crossing timer costs (specs/progression.md)",
  );
  assertEqual(expired.phase, "dying", "the hold a lost life starts");
});
