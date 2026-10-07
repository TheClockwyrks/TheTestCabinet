// instrumentation/timer-running-gate — `setTimerRunning(false)` holds the crossing
// clock where it stands, and turning it back on drains it in real seconds.
//
// specs/instrumentation.md fixes the gate: "The crossing timer's drain. `timer`
// holds the value it has however long a scenario runs. It still resets on a filled
// bay, and `timerMax` still follows the level." specs/progression.md fixes the
// drain it gates: "`timer` counts down while `phase` is `crossing` and no hold is
// running", in seconds.
//
// SO ONE POSED VALUE IS READ TWICE OVER THE SAME TEN SECONDS OF GAME TIME. With the
// gate off it must not have moved at all; with it on it must have fallen by exactly
// ten. Both halves run on the same crossing, so nothing but the gate separates
// them.
//
// EVERY LONG SCENARIO IN THIS SUITE RESTS ON THE FIRST HALF. `startCrossing` shuts
// this gate, and a build that ignored it would expire the crossing of every check
// that runs past `crossingTimer(1)` (`30` s) — a death under a heading about a
// mechanic that had nothing to do with the clock.
//
// THE POSED VALUE IS NEITHER `timerMax` NOR ZERO. `25` s is short of the `30` s a
// level-1 crossing opens with, so a build that ignored the pose and drained from
// its own full clock reads `20` after the second half rather than `15`, and long
// enough that ten seconds of drain leaves five to spare — the timer never reaches
// `0`, so nothing here costs a life and the phase stays `crossing` throughout.
//
// WHAT THIS DOES NOT DECIDE. Not what `timerMax` is at a level, which is
// `progression/timer-length-level-1`'s, and not what happens when the clock runs
// out, which is `progression/timer-costs-life`'s.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES, crossingTimer } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";

/** The value the crossing clock is posed at, in seconds. */
const POSED_TIMER = 25;

/** The span each half is watched over, in seconds: the ten this item names. */
const SPAN_SECONDS = 10;

/** What a running clock must read at the end of that span, in seconds. */
const DRAINED = POSED_TIMER - SPAN_SECONDS;

/**
 * How far a reading may sit from the seconds it is held to, as `assertCloseTo`
 * digits.
 *
 * Six digits is half a millionth of a second. `TICK_DT` is `1/120`, which is not
 * exact in binary, so twelve hundred subtractions land parts in a quadrillion from
 * the figure — this is that arithmetic and nothing else. A build whose clock drains
 * at any other rate, or that ignored the pose, misses by whole seconds.
 */
const SECOND_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the crossing clock while it is gated and drains it by the span once it is not", async () => {
  startCrossing(h);
  h.debug.setTimerRunning(false);
  h.debug.setTimer(POSED_TIMER);

  const posed = h.snapshot();
  assertEqual(
    posed.timer,
    POSED_TIMER,
    `the crossing clock as it was posed, short of the ${crossingTimer(1)} s a ` +
      `level-1 crossing opens with (specs/progression.md)`,
  );
  assertEqual(posed.phase, "crossing", "the phase the clock is watched in");

  await h.skip(SPAN_SECONDS);
  const held = h.snapshot();

  h.debug.setTimerRunning(true);
  await h.skip(SPAN_SECONDS);
  const drained = h.snapshot();
  await h.advance(1);
  // Before the assertions, so a clock that moved when it should not have still
  // leaves the picture of the HUD it moved on.
  captureStill(h, "gate");

  assertEqual(
    held.timer,
    POSED_TIMER,
    `the crossing clock after ${SPAN_SECONDS} s of a live crossing with ` +
      `setTimerRunning(false) — it "holds the value it has however long a ` +
      `scenario runs" (specs/instrumentation.md)`,
  );
  assertEqual(
    held.phase,
    "crossing",
    "the phase over that same span, in which no hold is running",
  );

  assertCloseTo(
    drained.timer,
    DRAINED,
    SECOND_DIGITS,
    `the crossing clock after ${SPAN_SECONDS} s more with setTimerRunning(true), ` +
      `against the ${POSED_TIMER} s posed less the ${SPAN_SECONDS} s that passed ` +
      `— the timer counts down in seconds while the phase is crossing ` +
      `(specs/progression.md)`,
  );
  assertEqual(
    drained.lives,
    START_LIVES,
    `the lives left over both spans — ${DRAINED} s are still on the clock, so ` +
      `nothing here reaches 0 and costs one (specs/progression.md)`,
  );
  assertEqual(
    drained.phase,
    "crossing",
    "the phase once the clock has drained, which no life lost has moved",
  );
});
