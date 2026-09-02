// instrumentation/timer-running-gate — `setTimerRunning` gates the crossing
// timer's drain and nothing else.
//
// specs/instrumentation.md gives the gate exactly that scope: "The crossing
// timer's drain. `timer` holds the value it has however long a scenario runs. It
// still resets on a filled bay, and `timerMax` still follows the level." Every
// gate is "on at a fresh start, is restored to on by `reset`, and is reported by
// `snapshot`". specs/progression.md fixes the drain the gate holds off: "`timer`
// counts down while `phase` is `crossing` and no hold is running."
//
// WITHOUT IT NO LONG SCENARIO IN THIS SUITE IS POSSIBLE. `startCrossing` shuts
// this gate so that a check running thirty or sixty seconds of game time is not
// killed by the clock partway through and graded on a death it never posed. That
// makes the gate load-bearing, and a gate the suite leans on has to be known to
// work before anything leaning on it means anything.
//
// SO THE SAME TEN SECONDS ARE SPENT TWICE, ONCE EACH SIDE OF THE GATE. Held, the
// timer must read exactly what it was posed at; running, it must read ten less.
// One direction alone would be half the requirement: a build whose timer never
// drains passes the first reading and fails the second, and a build that ignores
// the gate fails the first and passes the second, so the pair names which.
//
// THE POSED VALUE IS NEITHER `timerMax` NOR ZERO. `24` s is not `crossingTimer(1)`
// (`30` s), so a build that reset the timer to the level's own figure rather than
// holding the posed one reads `30` and is caught; and `14` s is still left when
// the running half ends, so nothing here rests on what reaching `0` does —
// `progression/timer-costs-life` decides that.
//
// THE STRAIT IS EMPTY AND THE PHASE IS `crossing` WITH NO HOLD, which is the one
// condition specs/progression.md makes the timer drain under, so a build that held
// the timer for the right reason in the second half would still fail.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, crossingTimer } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the crossing is posed on. */
const LEVEL = 1;

/** The seconds posed onto the clock: away from `crossingTimer(1)` and from `0`. */
const POSED_TIMER = 24;

/** The game time each half of the check spends, in seconds: the item's figure. */
const SECTION_SECONDS = 10;

/** What a draining clock reads at the end of the second half. */
const AFTER_DRAIN = POSED_TIMER - SECTION_SECONDS;

/**
 * How far a reading of the clock may sit from the seconds it is worth, in seconds.
 *
 * Two ticks. The timer drains one second per second of game time, so a build that
 * starts or ends its drain a tick either side of the section's boundary is out by
 * `TICK_DT`; this is twice that. The two wrong readings this check is looking for
 * are out by the whole ten seconds of the section.
 */
const TIMER_TOLERANCE = 2 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the crossing clock with the gate off and drains it with the gate on", async () => {
  // `startCrossing` leaves the gate off, which is the first half's arrangement.
  startCrossing(h, LEVEL);
  h.debug.setTimer(POSED_TIMER);

  const posed = h.snapshot();
  assertEqual(
    posed.timerRunning,
    false,
    "snapshot().timerRunning after setTimerRunning(false), which every gate " +
      "reports (specs/instrumentation.md)",
  );
  assertEqual(
    posed.phase,
    "crossing",
    "the phase the clock is read under, which is the one specs/progression.md " +
      "makes it drain in",
  );
  assertEqual(
    posed.timer,
    POSED_TIMER,
    `the seconds setTimer(${POSED_TIMER}) put on the clock`,
  );

  await h.advance(ticksFor(SECTION_SECONDS));
  const held = h.snapshot();

  h.debug.setTimerRunning(true);
  const opened = h.snapshot();
  await h.advance(ticksFor(SECTION_SECONDS));
  const drained = h.snapshot();
  // Before the assertions, so a failing clock still leaves the picture of the HUD
  // it was read on.
  captureStill(h, "gate");

  assertLessThanOrEqual(
    Math.abs(held.timer - POSED_TIMER),
    TIMER_TOLERANCE,
    `the seconds the crossing clock lost over ${SECTION_SECONDS} s of game time ` +
      `with setTimerRunning(false) — the timer holds the value it has however ` +
      `long a scenario runs (specs/instrumentation.md), so it must still read ` +
      `${POSED_TIMER}`,
  );
  assertEqual(
    opened.timerRunning,
    true,
    "snapshot().timerRunning after setTimerRunning(true)",
  );
  assertLessThanOrEqual(
    Math.abs(drained.timer - AFTER_DRAIN),
    TIMER_TOLERANCE,
    `the crossing clock after ${SECTION_SECONDS} s of game time with the gate ` +
      `on, which specs/progression.md drains one second per second from the ` +
      `${POSED_TIMER} s it held, to ${AFTER_DRAIN}`,
  );

  // The level was never changed, so `timerMax` still follows it: the gate holds
  // the drain and nothing else (specs/instrumentation.md).
  assertEqual(
    drained.timerMax,
    crossingTimer(LEVEL),
    `snapshot().timerMax across both halves, which follows the level rather ` +
      `than the gate (specs/progression.md)`,
  );
});
