// waves/wave-number-holds-through-the-build-phase — through a whole build phase
// the wave number reads the wave being prepared for.
//
// `specs/waves.md`, Wave numbering: "The current wave number is the wave being
// prepared for or fought, so a build phase belongs to the wave that follows it
// and the number reads the same right through that phase."
//
// SO THE READING IS A HOLD, NOT A VALUE, and it is taken across the WHOLE phase
// rather than at its start. `waves/clearing-advances-the-wave` already reads the
// number the instant a clear leaves behind; what this point adds is that the
// number does not drift, tick, or wait until the wave is released to catch up.
// The phase is watched for longer than `BUILD_PHASE_TIME` (`15` s), so the whole
// countdown, including the moment it reaches `0`, is inside the window.
//
// THE PHASE IS REACHED THROUGH A CLEAR, so the number under test is one the run
// itself arrived at rather than one this check wrote with `setWave`. Wave 5 is
// cleared by a leak, which `specs/waves.md` makes a clear like any other, and the
// build phase that opens therefore belongs to Wave 6.
//
// THE WORLD GATE STAYS SHUT, which is what keeps the phase alive for the whole
// window: `specs/instrumentation.md` says that with it off "a build timer driven
// to `0` leaves the phase where it stands" while "The timer still counts down".
// Without that, a conformant build would auto-start Wave 6 at the fifteen-second
// mark and the last seconds of the watch would be reading a `wave` phase instead
// — grading `build-timer-auto-starts`'s requirement by accident. The gate holds
// the run's own release of surge and nothing about the wave NUMBER, so nothing
// this point reads depends on it.
//
// WHAT EVERY WRONG MODEL READS. A build that advances the number when the next
// wave is released reads `6` throughout here and is caught by
// `clearing-advances-the-wave` instead; one that counts the number DOWN the build
// phase, or that shows the wave just fought until the release, reads `5`; one that
// advances again when the timer expires reads `7`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BUILD_PHASE_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { poseLeaker, poseWaveEnd, runUntilLeaked } from "./run";

/** The wave cleared, and the wave the build phase it opens belongs to. */
const CLEARED = 5;
const COMING = CLEARED + 1;

/**
 * How long the build phase is watched: a second past `BUILD_PHASE_TIME`.
 *
 * Geometry rather than a tolerance — it says how much of the phase is inside the
 * reading, not how far a build may miss a figure by. A whole phase is
 * `BUILD_PHASE_TIME` seconds, so a window a second longer covers all of it and
 * the instant the countdown reaches `0` as well.
 */
const WATCH_SECONDS = BUILD_PHASE_TIME + 1;

/** How often the number is sampled inside that window, in seconds of game time. */
const SAMPLE_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("reads the coming wave for the whole of the build phase before it", async () => {
  await startRun(h);
  await poseWaveEnd(h, CLEARED);
  await poseLeaker(h);
  const leaked = await runUntilLeaked(h);
  const cleared = await h.snapshot();

  const swept = await h.skipUntil((snapshot) => snapshot.wave !== COMING, {
    maxSeconds: WATCH_SECONDS,
    pollSeconds: SAMPLE_SECONDS,
  });

  await captureStill(h, "holding");

  assertTrue(
    leaked,
    `precondition: Wave ${CLEARED}'s last unit left the floor, clearing the wave`,
  );
  assertEqual(
    cleared.phase,
    "building",
    `precondition: the clear of Wave ${CLEARED} opened a build phase`,
  );
  assertEqual(
    swept.snapshot.wave,
    COMING,
    `the wave number ${swept.elapsed} seconds into the build phase that prepares for Wave ${COMING}`,
  );
});
