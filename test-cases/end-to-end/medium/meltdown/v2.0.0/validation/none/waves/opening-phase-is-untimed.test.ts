// waves/opening-phase-is-untimed — the phase before Wave 1 carries no clock and
// starts no wave of its own.
//
// `specs/waves.md`, The opening phase: it "runs before Wave 1. It carries no
// countdown, reports a `buildTimer` of `0`, and never starts a wave on its own
// however long it runs. Sending is what begins Wave 1." The phase table says the
// same in the other column: the surge released in the `opening` phase is "None".
//
// THE RUN'S OWN RELEASE OF SURGE IS LEFT ON, and that is what makes this a
// reading rather than a tautology. `specs/instrumentation.md`'s world gate holds
// "the build timer's automatic start of the next wave when it reaches `0`, and
// the spawner's release of the units counted by `wavePending`", so a scenario
// that had shut it would see no wave start whatever the build does with the
// clock — it would be grading the gate it closed itself. `poseOpening` reaches
// the phase through `reset`, which `specs/instrumentation.md` requires to restore
// `phase` to `"opening"`, `buildTimer` to `0`, `wave` to `1` and the gate back
// on, so every figure read here is one the game restored rather than one this
// check wrote.
//
// A MINUTE IS FOUR BUILD PHASES. `BUILD_PHASE_TIME` is `15` seconds, so a build
// that runs the between-wave countdown in the opening phase has had four chances
// to reach `0` and start a wave inside this window, and one that starts Wave 1 on
// a timer of its own has had a minute to do it.
//
// AND THE FLOOR IS READ AS WELL AS THE CLOCK, because the phase table's other
// column says the surge released in the `opening` phase is "None". A build that
// held the phase and the timer where they were while its spawner let units out
// has broken the same sentence — "never starts a wave on its own however long it
// runs" — and would be invisible to a reading of `phase` and `buildTimer` alone.
// So the roster is watched over the same minute and must stay empty.
//
// WHAT EVERY WRONG MODEL READS. A build that opens the phase with a
// `BUILD_PHASE_TIME` countdown reads a falling `buildTimer` and then a `wave`
// phase; one that counts down from `0` reads a negative `buildTimer`; one that
// starts Wave 1 after a fixed delay reads a `wave` phase with the timer still at
// `0`; one whose spawner runs in the opening phase reads a unit on the floor.
// Each is a different reading from a phase that sits at `0`, stays where it is,
// and releases nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BUILD_PHASE_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  DRIVE_HZ,
  type Harness,
} from "../harness";
import { poseOpening } from "./run";

/**
 * How long the phase is watched: a minute of game time, four `BUILD_PHASE_TIME`
 * countdowns end to end.
 *
 * Geometry rather than a tolerance: it says how long the phase is given to betray
 * a clock, not how far a build may miss a figure by.
 */
const WATCH_SECONDS = 60;

/** How often the phase is sampled inside that minute, in seconds of game time. */
const SAMPLE_SECONDS = 1;

/**
 * How far from `0` a reported `buildTimer` may sit.
 *
 * `specs/waves.md` fixes the figure at exactly `0`, so this is not a tolerance on
 * the requirement — it is float noise around a zero a build may have arrived at
 * by accumulating a difference rather than by writing a literal. A millionth of a
 * second is far below anything a countdown could hide in: the shortest countdown
 * the game has is `BUILD_PHASE_TIME` (`15`) seconds, seven orders of magnitude
 * above it.
 */
const TIMER_TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the opening phase at a zero timer for a minute of game time", async () => {
  await poseOpening(h);

  const swept = await h.coastUntil(
    (snapshot) =>
      snapshot.phase !== "opening" ||
      Math.abs(snapshot.buildTimer) > TIMER_TOLERANCE ||
      snapshot.surge.length > 0,
    // Diced on the long-drive clock (`harness.ts`, The long-drive clock): the
    // minute is the requirement, the frame rate is this check's to choose.
    { maxSeconds: WATCH_SECONDS, pollSeconds: SAMPLE_SECONDS, hz: DRIVE_HZ },
  );

  await captureStill(h, "opening");

  assertEqual(
    swept.snapshot.phase,
    "opening",
    `the phase after ${swept.elapsed} seconds of the opening phase, with the run's own release of surge on`,
  );
  assertLessThanOrEqual(
    Math.abs(swept.snapshot.buildTimer),
    TIMER_TOLERANCE,
    `the buildTimer the opening phase reports after ${swept.elapsed} seconds, against the ${BUILD_PHASE_TIME}-second countdown a build phase carries`,
  );
  assertEqual(
    swept.snapshot.surge.length,
    0,
    `the units standing on the floor after ${swept.elapsed} seconds of the opening phase, whose released surge specs/waves.md gives as None`,
  );
});
