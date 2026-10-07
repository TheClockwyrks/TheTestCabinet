// bands/inversion-refreshes — a fresh trigger sets the remaining time back.
//
// specs/bands.md: "At most one inversion is active at a time. A fresh trigger
// while one is running sets the remaining time back to `INVERSION_TIME` rather
// than adding to it."
//
// WHY THE TRIGGER IS A REAL PRISM. `setInversion` poses the inversion already
// running — that is the precondition — but it can never be the trigger under
// test: calling it twice would satisfy the refresh rule by the operation's own
// contract, whatever the build's own trigger does, and would grade nothing. So
// the second inversion is started the way the game starts one, by the trigger
// specs/drones.md fixes: "When a diving Prism with a layer still intact has its
// center cross `PRISM_INVERT_Y` (`640`) traveling downward, it triggers a
// spectral inversion."
//
// THE POSTURE, which is the one `drones/prism-triggers-inversion` uses: a Prism
// with its shell intact is posed in phase `diving` 30 units above
// `PRISM_INVERT_Y`, its own locomotion turned on and its fire left off, and the
// build flies it across the line under its own dive code. Nothing about the
// crossing is posed, so what raises the inversion is the game's own trigger.
//
// THE DISTINGUISHING VALUE. The inversion is posed with 4.5 of its 5 seconds
// left, so the three models read apart at the crossing whenever it falls: a build
// that sets the time back reads INVERSION_TIME (5.0), one that ADDS reads between
// 5.5 and 9.5 depending on how long the dive took, and one that ignores a fresh
// trigger while an inversion is already running keeps counting down and never
// satisfies the sweep at all. A large partial is what makes the additive reading
// unmistakable; it is still a partial, which is all specs/bands.md's refresh rule
// needs. The tolerance is 0.05 s — five frames of the harness's 100 Hz clock,
// enough for a build that spends the crossing frame's own countdown on the fresh
// time, and nine times narrower than the closest additive reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { FORM_CENTER_X, INVERSION_TIME, PRISM_INVERT_Y } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The seconds of inversion the scenario starts with: 0 < PARTIAL < INVERSION_TIME.
 *
 * Nine tenths of `INVERSION_TIME`. Two things follow from it: an additive reading
 * is at least half a second clear of the refreshed one however long the dive
 * takes, and the running inversion cannot expire before the crossing, since
 * {@link CROSSING_FRAMES} stops the sweep half a second short of PARTIAL. A
 * scenario whose posed inversion ran out would be watching a FIRST trigger rather
 * than a refresh, and would pass a build that never refreshes anything.
 */
const PARTIAL = 4.5;

/**
 * How far above `PRISM_INVERT_Y` the diving Prism is posed, in logical units.
 *
 * Its own contact half-extent is `PRISM_HALF` (28), so 30 places its centre
 * clear above the line rather than already across it, and leaves the dive a tenth
 * of a second of travel at `DIVE_SPEED` (300) to carry it over.
 */
const ABOVE_LINE = 30;

/**
 * Frames the dive is allowed to carry the Prism across the line.
 *
 * Four seconds. specs/swarm.md fixes only the speed along a dive's path
 * (`DIVE_SPEED` 300, times `droneSpeedScale(1)` = 1) and leaves the path itself
 * to the build — "a smooth swooping path of your design" that "bends toward the
 * ship's current `x`" — so the 30-unit descent to the line can cost a build many
 * times 30 units of travel. Four seconds is 1200 units of path for that descent,
 * which is most of the eight seconds a whole dive is allowed, and it still stops
 * the sweep half a second before the posed inversion could expire.
 */
const CROSSING_FRAMES = 400;

/** Seconds of slack on the refreshed reading. Five frames of the 100 Hz clock. */
const REFRESH_TOLERANCE = 0.05;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("sets the running inversion back to INVERSION_TIME rather than adding to it", async () => {
  await startPosed(harness);
  await harness.debug.setInversion(PARTIAL);
  const posed = await harness.snapshot();
  assertEqual(posed.inversionActive, true, "the inversion the scenario posed");
  assertEqual(
    posed.isChallenge,
    false,
    "a standard stage, where a Prism dives",
  );

  await poseDrone(
    harness,
    "prism",
    FORM_CENTER_X,
    PRISM_INVERT_Y - ABOVE_LINE,
    { band: "cyan", phase: "diving", shell: true, travel: true },
  );

  const refreshed = await harness.until((s) => s.inversion > PARTIAL, {
    maxFrames: CROSSING_FRAMES,
  });
  await captureStill(harness, "refreshed");

  assertEqual(
    refreshed.hit,
    true,
    "the diving Prism crossing PRISM_INVERT_Y raising the running inversion (specs/drones.md)",
  );
  assertBetween(
    refreshed.snapshot.inversion,
    INVERSION_TIME - REFRESH_TOLERANCE,
    INVERSION_TIME + REFRESH_TOLERANCE,
    "the seconds left after a fresh trigger, which sets the time back to INVERSION_TIME rather than adding to it (specs/bands.md)",
  );
});
