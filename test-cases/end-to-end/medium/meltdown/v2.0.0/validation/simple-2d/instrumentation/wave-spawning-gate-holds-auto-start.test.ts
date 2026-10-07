// Meltdown — instrumentation/wave-spawning-gate-holds-auto-start: wave spawning off
// holds the auto-start.
//
// specs/instrumentation.md, The world gate: the gate holds "the build timer's
// automatic start of the next wave when it reaches `0`" as well as the spawner's
// release — "a build timer driven to `0` leaves the phase where it stands. The timer
// still counts down".
//
// THE GATE HOLDS TWO THINGS, AND THIS IS THE ONE THE ROSTER CANNOT SHOW.
// `wave-spawning-gate` reads the release; a build that held the release but let the
// timer start the wave anyway would pass it, and would then move every scenario in
// this suite into a `wave` phase fifteen seconds in — clearing its towers' freshness
// and queueing a wave the check never asked for. So this point reads the PHASE, on
// both sides of the timer reaching zero.
//
// THE TIMER IS POSED AT HALF A SECOND, which the suite's clock covers in exactly
// sixty whole frames, and the window is a full second — twice as long. So the timer
// reaches `0` well inside the window on any conforming build, and the reading is
// taken with the crossing long past rather than at the frame it happens on.
//
// AND THE TIMER ITSELF IS READ AT `0`. specs/instrumentation.md has the timer go on
// counting down with the gate shut, and the item asks for it "at 0": a build that
// runs the countdown into negative seconds while the phase waits is holding the
// phase for the wrong reason, and one that stops the countdown short of `0` has held
// something the gate does not hold.
//
// THE SAME TIMER IS DRIVEN TO ZERO WITH THE GATE OPEN, because "the phase stands" is
// a claim about the GATE and not about a run whose timer does nothing: a build that
// never starts a wave from a timer passes the held leg outright and fails this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds left on the timer when the leg opens: exactly sixty frames. */
const TIMER = 0.5;

/** The window each leg is driven over: twice the timer, so the crossing is past. */
const WINDOW_TICKS = ticksFor(2 * TIMER);

/**
 * How closely the held timer must rest at `0`, as decimal places.
 *
 * Three places is `0.0005` seconds, which is a sixteenth of one frame of the suite's
 * clock. The posed `0.5` seconds is a whole number of those frames, so a conforming
 * build lands exactly on `0` and holds there; what the bound has to refuse is a build
 * that ran the countdown on past zero, which over the remaining half-second is off by
 * `0.5`.
 */
const TIMER_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Open a build phase with `TIMER` seconds left and the gate as named. */
function poseBuildPhase(gate: boolean): void {
  startRun(h);
  h.debug.setWaveSpawning(gate);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(TIMER);
}

it("leaves the phase building and the timer at 0 with the gate off", async () => {
  poseBuildPhase(false);
  await h.advance(WINDOW_TICKS);
  const held = h.snapshot();
  captureStill(h, "held");

  assertEqual(
    held.phase,
    "building",
    "the phase, with the timer driven to 0 and the gate off",
  );
  assertCloseTo(
    held.buildTimer,
    0,
    TIMER_DIGITS,
    "the seconds left on the timer, with the gate off",
  );
});

it("starts the wave from the same timer with the gate on", async () => {
  poseBuildPhase(true);
  await h.advance(WINDOW_TICKS);
  const started = h.snapshot();
  captureStill(h, "started");

  assertEqual(
    started.phase,
    "wave",
    "the phase, with the timer driven to 0 and the gate on",
  );
});
