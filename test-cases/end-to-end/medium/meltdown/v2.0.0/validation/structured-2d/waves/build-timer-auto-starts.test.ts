// Meltdown — waves/build-timer-auto-starts: a build timer reaching 0 starts the
// wave.
//
// `specs/waves.md`, A build phase: "Reaching `0` starts the wave, and sending
// starts it earlier." The phase table in the same file gives `wave` as the phase
// in which surge is released.
//
// THE WORLD GATE IS OPEN, and it is exactly what this point is about. The gate
// holds "the build timer's automatic start of the next wave when it reaches `0`"
// (`specs/instrumentation.md`), so with it shut a build timer run to `0` leaves
// the phase where it stands however correct the build is. It is one of the items
// that gate exists for, and one of the only ones that turn it back on.
//
// TWO READINGS OF ONE RULE, BECAUSE `0` IS WHAT STARTS IT. Half way down the
// posed countdown the phase must still be `building`, and past the end of it the
// phase must be `wave`. A build that starts its wave the moment a build phase
// opens — which is a run with no build phase in it at all — passes a reading
// taken only at the end, and fails the first one here.
//
// THE COUNTDOWN IS POSED SHORT, at `3` seconds rather than the phase's own
// `BUILD_PHASE_TIME` (`15`). `setBuildTimer` "sets the seconds left in the
// current build phase" and poses that field alone
// (`specs/instrumentation.md`), so what the game is handed is an ordinary build
// phase most of the way through its countdown. Nothing about the figure the
// phase opens at enters this reading; that is `waves.build-timer-counts-down`'s
// and the phase's own.
//
// THE SLACK PAST THE END IS HALF A SECOND, which is a sixth of the posed
// countdown and far more than any frame ordering costs. What it excludes is
// nothing: a build that starts its wave a second late has a countdown that does
// not count, which `waves.build-timer-counts-down` reads directly.
//
// WHAT EVERY WRONG MODEL READS. A build that never starts a wave on its own is
// still `building` at the end; one that starts it on entering the phase is
// already `wave` at the halfway reading; one whose gate is wired to the spawner
// alone leaves the phase `building` with `wavePending` set.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The countdown posed on the build phase, in seconds of game time. */
const COUNTDOWN = 3;

/** The frames spent before the countdown could have reached `0`: half of it. */
const HALFWAY_TICKS = ticksFor(COUNTDOWN / 2);

/**
 * The frames spent past the halfway mark, carrying the countdown half a second
 * beyond `0`.
 *
 * The slack is a sixth of the posed countdown: far past any frame-ordering
 * difference, and far short of the second a build would have to be late by for
 * the lateness itself to be the defect.
 */
const REST_TICKS = ticksFor(COUNTDOWN / 2 + 0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the phase until the countdown reaches 0 and starts the wave there", async () => {
  startRun(h);
  h.debug.setPhase("building");
  h.debug.setBuildTimer(COUNTDOWN);
  h.debug.setWaveSpawning(true);

  await h.advance(HALFWAY_TICKS);
  const halfway = h.snapshot().phase;

  await h.advance(REST_TICKS);
  const ended = h.snapshot().phase;

  captureStill(h, "started");

  assertEqual(
    halfway,
    "building",
    `the phase ${COUNTDOWN / 2} s into a ${COUNTDOWN} s countdown`,
  );
  assertEqual(
    ended,
    "wave",
    `the phase half a second after a ${COUNTDOWN} s countdown reached 0`,
  );
});
