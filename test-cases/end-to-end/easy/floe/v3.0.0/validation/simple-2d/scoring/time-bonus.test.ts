// scoring/time-bonus — a completing hop pays two points for every WHOLE second
// left on the crossing timer.
//
// specs/scoring.md: "The time bonus | `SCORE_TIME_BONUS` (`2`) per whole second |
// A crossing ends in an open bay, paid `floor(timer)` times over."
//
// IT IS READ AS A DIFFERENCE BETWEEN TWO IDENTICAL COMPLETING HOPS. The same bay,
// at the same level, from the same tile, with only the posed timer changed: once
// with the clock empty and once with 7.4 s on it. What the pair measures is the
// time bonus alone — the row award and the bay award are in both readings and
// cancel — so this point cannot fail for a wrong `SCORE_ROW` or a wrong
// `SCORE_BAY`, which are `row-advance`'s and `bay-award`'s to decide.
//
// 7.4 IS THE DISTINGUISHING VALUE. `floor(7.4)` is 7, so the difference must be
// `SCORE_TIME_BONUS * 7` (14). A build paying for every second STARTED reads 16, a
// build paying on the unrounded timer reads 14.8, a build paying a flat bonus
// reads 0, and a build paying per second at a rate of its own reads its own
// multiple of 7. (A build that rounds to the nearest second reads 7 whole seconds
// here too: `floor` and round agree below the half second, and the fractional
// part is deliberately below it so that paying for a STARTED second is what
// stands out.)
//
// THE TIMER IS POSED, NEVER RUN. `startCrossing` shuts the timer gate, so the
// whole-second count the award reads is the one this check chose rather than one
// the drain moved between the pose and the hop.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { SCORE_TIME_BONUS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { completingHop } from "./crossing";

/** The bay both crossings end in. */
const BAY = 3;

/** The two posed timers: an empty clock, and one with seven whole seconds on it. */
const DRY_TIMER = 0;
const LEFT_TIMER = 7.4;

/** The whole seconds `LEFT_TIMER` holds, which is what the award is paid over. */
const WHOLE_SECONDS = Math.floor(LEFT_TIMER);

/** What the second hop pays over the first: two points a whole second. */
const EXPECTED_EXTRA = SCORE_TIME_BONUS * WHOLE_SECONDS;

/**
 * How close the posed timer must read back.
 *
 * A hundredth of a second: `setTimer` sets the seconds left
 * (specs/instrumentation.md) and nothing drains them with the gate shut, so this
 * is a floating-point tolerance and not a physical one — an eighth of the 0.4 s
 * that separates 7.4 from the whole second below it.
 */
const TIMER_DIGITS = 2;

/** Frames recorded after the measured hop, for the replay alone. */
const AFTER_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays two points more a whole second left than the same hop on an empty clock", async () => {
  // The control: the same hop with the clock empty, so its reading carries the
  // row award and the bay award and no time bonus at all.
  startCrossing(h);
  h.debug.setTimer(DRY_TIMER);
  const dry = await completingHop(h, BAY);
  assertEqual(dry.landed.bays[BAY], true, `bay ${BAY} filled on the dry clock`);

  // The measurement: a fresh crossing, everything as before, 7.4 s posed.
  startCrossing(h);
  h.debug.setTimer(LEFT_TIMER);
  const posed = h.snapshot();
  assertCloseTo(posed.timer, LEFT_TIMER, TIMER_DIGITS, "the posed timer");
  assertEqual(posed.timerRunning, false, "the timer held where it was posed");

  const left = await captureReplay(h, "score", async () => {
    const paid = await completingHop(h, BAY);
    await h.advance(AFTER_FRAMES);
    return paid;
  });

  assertEqual(left.landed.bays[BAY], true, `bay ${BAY} filled with time left`);

  assertEqual(
    left.paid - dry.paid,
    EXPECTED_EXTRA,
    `SCORE_TIME_BONUS for each of the ${WHOLE_SECONDS} whole seconds left`,
  );
});
