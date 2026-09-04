// Meltdown — instrumentation/wave-spawning-gate-holds-auto-start: wave spawning
// off holds the auto-start.
//
// `specs/instrumentation.md`, the world gate: `setWaveSpawning` gates "the build
// timer's automatic start of the next wave when it reaches `0`" as well as the
// release, and "Off ... a build timer driven to `0` leaves the phase where it
// stands. The timer still counts down". `specs/waves.md` states the auto-start it
// is holding: a build phase's timer "falls by one second per second of game time.
// Reaching `0` starts the wave".
//
// THIS IS THE HALF OF THE GATE `wave-spawning-gate` DOES NOT READ, and it is the
// half every long scenario in this suite depends on: `harness.ts` opens a run in
// its build phase with fifteen seconds on the clock, so any check that spends
// longer than that would watch its floor turn into a wave if only the release
// were held.
//
// THE TIMER IS DRIVEN TO `0` RATHER THAN POSED THERE. A timer posed at `0` never
// crosses anything, and the auto-start is a CROSSING — a build could plausibly
// start its wave on the frame the timer passes zero and this reading has to give
// it that frame. So the timer is posed a fraction of a second above zero and the
// run is left to count it down, and then given several seconds more, so a build
// whose start is a frame late is still caught.
//
// AND THE TIMER MUST STILL HAVE FALLEN. "The timer still counts down" is the
// other half of the sentence: a build that held the whole phase still — timer and
// all — would leave the phase `building` and pass a check that only read the
// phase. So the quiet leg asserts the timer reached `0` as well as that the phase
// did not move.
//
// THE OPEN LEG IS THE SAME FLOOR WITH THE GATE ON, because a build that never
// starts a wave at all passes the quiet leg outright.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds the timer is posed with, so it has a zero to fall through. */
const TIMER = 0.5;

/**
 * The game time each leg is given, in seconds.
 *
 * Several times the timer posed, so a build whose auto-start lands a frame or two
 * after the crossing has landed it well inside the window and the quiet leg's
 * verdict is not a matter of timing.
 */
const WINDOW = 4;

/**
 * How far the run-down timer may sit from `0`, in seconds.
 *
 * `specs/waves.md` falls one second per second of game time and holds at `0`, so
 * a build that counted the whole window down reports zero itself; the allowance
 * is for the float it accumulates it in. It is many orders below the one frame of
 * the suite's clock that separates zero from not-yet.
 */
const ZERO_TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A run in its build phase with `TIMER` seconds left and the gate as given. */
function poseBuildPhase(spawning: boolean): void {
  startRun(h);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(TIMER);
  h.debug.setWaveSpawning(spawning);
}

it("leaves the phase building when the timer runs out with the gate off, and starts the wave with it on", async () => {
  // ---- The gate closed ---------------------------------------------------
  poseBuildPhase(false);
  assertEqual(h.snapshot().phase, "building", "precondition: the phase posed");
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "held");
  const held = h.snapshot();

  assertEqual(
    held.phase,
    "building",
    `the phase after the timer ran out over ${WINDOW} seconds with the gate off`,
  );
  assertLessThan(
    Math.abs(held.buildTimer),
    ZERO_TOLERANCE,
    "the build timer, which counts down whatever the gate does",
  );

  // ---- The gate open, on an identical floor ------------------------------
  poseBuildPhase(true);
  assertEqual(h.snapshot().phase, "building", "precondition: the phase posed");
  await h.advance(ticksFor(WINDOW));
  captureStill(h, "started");

  assertEqual(
    h.snapshot().phase,
    "wave",
    "the phase after the timer ran out with the gate on",
  );
});
