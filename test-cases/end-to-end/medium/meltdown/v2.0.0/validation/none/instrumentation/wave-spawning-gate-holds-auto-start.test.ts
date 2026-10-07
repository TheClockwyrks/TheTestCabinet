// Meltdown — instrumentation/wave-spawning-gate-holds-auto-start: with the world
// gate shut, a build timer running out does not start the wave; with it open, it
// does.
//
// THE RULE. `specs/instrumentation.md` gives `setWaveSpawning(enabled)` two
// things to gate, and this is the second: "the build timer's automatic start of
// the next wave when it reaches `0` ... a build timer driven to `0` leaves the
// phase where it stands. The timer still counts down". `specs/waves.md` states the
// behaviour the gate suppresses: a build phase's timer "falls by one second per
// second of game time. Reaching `0` starts the wave".
//
// WHY IT IS A POINT SEPARATE FROM THE SPAWNER'S HALF. `startRun` poses a build
// phase with a FULL timer of `BUILD_PHASE_TIME` (`15` seconds), and a great many
// checks in this project then spend more game time than that: a thermal settle, a
// slow expiring, a trip cooling out. If the gate holds the spawner but not the
// auto-start, every one of those scenarios silently drops out of `building` and
// into `wave` part way through — and the checks that then read the phase, or the
// freshness that ends with it (`specs/building.md`), fail naming the run's
// transitions rather than the gate.
//
// THE TIMER IS POSED SHORT AND THEN OVERRUN. A second on the clock and two seconds
// of game time driven, so the timer does not merely reach `0` but is left sitting
// there for a further second — which is where a build that starts the wave one
// frame late is caught, and where the specification's "leaves the phase where it
// stands" is really tested.
//
// THREE READINGS ON THE SHUT LEG, because the gate holds the START and not the
// COUNTDOWN: the phase is still `building`, the timer has run down to `0` rather
// than stopping early, and nothing was released. And the open leg poses the
// same run and must reach `wave`, because a build with no auto-start at all
// passes the shut leg outright.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  type Harness,
} from "../harness";

/** The timer posed, and the game time driven over it. */
const TIMER_SECONDS = 1;
const DRIVE_SECONDS = 2;

/**
 * How close the run-out timer must come to `0`, in decimal places: within `0.05`
 * of a second.
 *
 * `specs/waves.md` has the timer fall one second per second and `0` is where it
 * stops, so this is one frame of the harness's clock either way — room for a build
 * whose last frame lands a fraction past the boundary and for nothing else. It
 * excludes both a timer that stopped early and one that ran a further second into
 * the negative.
 */
const TIMER_DIGITS = 3;

let h: Harness;

/** Pose a between-wave build phase whose timer is about to run out. */
async function poseAnExpiringBuildPhase(): Promise<void> {
  await startRun(h);
  await h.debug.setBuildTimer(TIMER_SECONDS);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the phase building when the timer runs out with the gate shut", async () => {
  await poseAnExpiringBuildPhase();
  assertEqual(
    (await h.snapshot()).waveSpawning,
    false,
    "the world gate the run was posed with",
  );

  await h.advance(framesFor(DRIVE_SECONDS));
  await captureStill(h, "held");

  const s = await h.snapshot();
  assertEqual(
    s.phase,
    "building",
    "the phase after the timer ran out, gate shut",
  );
  assertCloseTo(
    s.buildTimer,
    0,
    TIMER_DIGITS,
    "the build timer after it ran out, gate shut",
  );
  assertLength(
    s.surge,
    0,
    "the surge roster after the timer ran out, gate shut",
  );
});

it("starts the wave when the timer runs out with the gate open", async () => {
  await poseAnExpiringBuildPhase();
  await h.debug.setWaveSpawning(true);

  await h.advance(framesFor(DRIVE_SECONDS));
  await captureStill(h, "started");

  assertEqual(
    (await h.snapshot()).phase,
    "wave",
    "the phase after the timer ran out, gate open",
  );
});
