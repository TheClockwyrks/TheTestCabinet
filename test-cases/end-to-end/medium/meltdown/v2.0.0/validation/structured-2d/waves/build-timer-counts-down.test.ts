// Meltdown — waves/build-timer-counts-down: the between-wave timer falls one
// second per second of game time.
//
// `specs/waves.md`, A build phase: "A build phase between waves begins with
// `buildTimer` at `BUILD_PHASE_TIME` (`15`) seconds. The timer falls by one
// second per second of game time." `specs/waves.md`'s opening paragraph fixes
// what game time is: "The game advances by the elapsed time of every frame,
// multiplied by the game speed. Every rate in this specification is per second
// and is integrated against that game time."
//
// THE DROP IS READ, NOT THE VALUE. What the timer stood at when the phase opened
// is `BUILD_PHASE_TIME`, which is a figure of the phase rather than of the
// countdown; what this point is about is the RATE, so it reads the difference
// between the timer at the start of a window and at the end of it and holds that
// against the game time the window spent. A build that opened its phase at some
// other figure fails elsewhere and still has its countdown graded here.
//
// FIVE SECONDS, A THIRD OF A PHASE. Long enough that a build counting at a wrong
// rate misses by whole seconds — one counting per FRAME rather than per second
// would run out inside a fraction of it, one counting at half speed reads `2.5`
// — and short enough that the timer never reaches `0`, so nothing about what
// happens at `0` enters the reading. That belongs to
// `waves.build-timer-auto-starts`.
//
// THE WORLD GATE STAYS SHUT, as `startRun` leaves it.
// `specs/instrumentation.md` is explicit that the gate holds the timer's
// automatic start of the next wave and nothing else: "the timer still counts
// down". So the countdown under test runs exactly as it does in a run, and no
// wave can arrive across the window.
//
// WHAT EVERY WRONG MODEL READS. A build that does not count reads a drop of `0`;
// one counting at half speed reads `2.5`; one counting at double reads `10`; one
// subtracting a whole second per frame has run its timer to `0` long before the
// window closes and reads the whole `15`.

import { afterEach, beforeEach, it } from "vitest";
import { BUILD_PHASE_TIME } from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The window the countdown is measured over, in frames and in seconds. */
const WINDOW_TICKS = ticksFor(5);
const WINDOW_SECONDS = seconds(WINDOW_TICKS);

/**
 * How close the drop must come to the game time spent, as decimal places.
 *
 * One place is `0.05` of a second, six frames of the suite's `120` Hz clock. A
 * build integrating the countdown against the frame's own elapsed time has no
 * need of the room; what the bound excludes is every other reading of the rule,
 * none of which lands within a whole second of `5`.
 */
const DROP_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls by one second per second of game time", async () => {
  startRun(h);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(BUILD_PHASE_TIME);

  const opened = h.snapshot().buildTimer;
  await h.advance(WINDOW_TICKS);
  const closed = h.snapshot();

  captureStill(h, "timer");

  assertEqual(
    closed.phase,
    "building",
    "precondition: the phase was still building when the window closed",
  );
  assertCloseTo(
    opened - closed.buildTimer,
    WINDOW_SECONDS,
    DROP_DIGITS,
    `the seconds the timer fell over ${WINDOW_SECONDS} s of game time`,
  );
});
