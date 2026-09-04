// waves/build-timer-counts-down — the between-wave timer falls one second per
// second of game time.
//
// `specs/waves.md`, A build phase: "A build phase between waves begins with
// `buildTimer` at `BUILD_PHASE_TIME` (`15`) seconds. The timer falls by one
// second per second of game time."
//
// A SLOPE IS READ, NOT A TOTAL. The claim is a RATE, so the reading is the fall
// across a known stretch of game time rather than the figure the timer holds at
// any one moment — what the timer opens at is the same specification sentence but
// a different reading, and `build-timer-auto-starts` is what happens when it
// reaches `0`.
//
// THE TIMER IS POSED AT A FIGURE THAT IS NOT `BUILD_PHASE_TIME`. `12.5` is
// neither the phase's opening figure nor a whole number, so a build that ignores
// what it was handed and counts down from `15` reads a fall of `2.5` more than
// this window spent, and one that rounds its timer to whole seconds reads a fall
// that misses by half a second. `setBuildTimer` "sets the seconds left in the
// current build phase" and nothing else (`specs/instrumentation.md`), so posing
// it starts no wave and pays nothing.
//
// THE WINDOW STOPS WELL SHORT OF `0`. `12.5` falls to `7.5` across the five
// seconds driven, so the timer never reaches the boundary that starts a wave and
// this reading is the countdown alone. The world gate `startRun` leaves shut also
// keeps that boundary harmless: `specs/instrumentation.md` says that with it off
// "The timer still counts down" while "a build timer driven to `0` leaves the
// phase where it stands".
//
// THE PHASE IS WAVE 2's, a genuine between-wave build phase rather than the
// untimed opening one, which `waves/opening-phase-is-untimed` grades separately.
//
// WHAT EVERY WRONG MODEL READS. A build whose timer does not run reads a fall of
// `0`; one counting real frames rather than game time reads a fall that follows
// the frame rate; one counting at double reads `10`; one counting UP reads `-5`.
// Each is a different number from `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  type Harness,
} from "../harness";

/** The between-wave phase read: an ordinary one, well short of the run's last. */
const WAVE = 2;

/**
 * The seconds the timer is posed at, and the seconds of game time driven.
 *
 * `12.5` is neither `BUILD_PHASE_TIME` nor a whole number, and `12.5 - 5` is
 * `7.5`, which is neither of those either.
 */
const POSED = 12.5;
const WINDOW = 5;

/**
 * How far the fall may miss `WINDOW` by: five hundredths of a second.
 *
 * The rate is exact — one second per second — so this is measurement slack, not
 * licence. The drive covers `WINDOW` seconds of game time in frames of
 * `1 / 120` s, and a build integrating its countdown against those frames lands
 * within one frame of the total however it accumulates; a build that runs its
 * countdown on a coarser internal step could be a few frames out. Five hundredths
 * is six frames of the drive, and it is a hundredth of the fall being measured,
 * so no wrong rate can hide inside it: the nearest wrong model, a countdown at
 * `0.99` seconds per second, would still have to be within half a per cent of
 * correct to pass.
 */
const TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("falls by one second for every second of game time", async () => {
  await startRun(h);
  await h.debug.setWave(WAVE);
  await h.debug.setBuildTimer(POSED);

  const opened = await h.snapshot();
  await h.advance(framesFor(WINDOW));
  const settled = await h.snapshot();

  await captureStill(h, "timer");

  assertEqual(
    opened.phase,
    "building",
    `precondition: a between-wave build phase for Wave ${WAVE}`,
  );
  assertLessThanOrEqual(
    Math.abs(opened.buildTimer - settled.buildTimer - WINDOW),
    TOLERANCE,
    `how far the ${opened.buildTimer - settled.buildTimer} seconds the timer fell misses the ${WINDOW} seconds of game time driven`,
  );
});
