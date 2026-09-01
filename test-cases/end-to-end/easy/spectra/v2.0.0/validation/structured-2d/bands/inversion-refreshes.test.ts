// bands/inversion-refreshes — a fresh trigger sets the remaining time back.
//
// specs/bands.md: "At most one inversion is active at a time. A fresh trigger while
// one is running sets the remaining time back to `INVERSION_TIME` rather than
// adding to it."
//
// WHY THE TRIGGER IS A REAL PRISM. `setInversion` poses the inversion already
// running — that is the precondition — but it can never be the trigger under test:
// calling it twice would satisfy the refresh rule by the operation's own contract
// whatever the build's own trigger does, which grades nothing. So the second
// inversion is started the way the game starts one, by the trigger
// specs/drones.md fixes: "When a diving Prism with a layer still intact has its
// center cross `PRISM_INVERT_Y` (`640`) traveling downward, it triggers a spectral
// inversion."
//
// THE POSTURE is the one `drones.prism-triggers-inversion` uses: a Prism with its
// shell intact, posed in phase `diving` {@link ABOVE_LINE} units above
// `PRISM_INVERT_Y`, with its own locomotion turned on and its fire left off, and
// the build flies it across the line under its own dive code. Nothing about the
// crossing is posed, so what raises the inversion is the game's own trigger.
// Locomotion is the one faculty turned on, because it is the one the requirement
// needs.
//
// THE DISTINGUISHING VALUE. The inversion is posed with {@link PARTIAL} of its 5
// seconds left, so the three models read apart at the crossing whenever it falls:
// a build that SETS THE TIME BACK reads `INVERSION_TIME` (5.0), one that ADDS
// reads between 5.5 and 9.5 depending on how long the dive took, and one that
// IGNORES a fresh trigger while an inversion is already running keeps counting
// down and never satisfies the sweep at all. A large partial is what makes the
// additive reading unmistakable; it is still a partial, which is all the refresh
// rule needs.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  FORM_CENTER_X,
  INVERSION_TIME,
  PRISM_INVERT_Y,
} from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/**
 * The seconds of inversion the scenario starts with: `0 < PARTIAL <
 * INVERSION_TIME`, as the review item requires.
 *
 * Nine tenths of `INVERSION_TIME`. Two things follow: an additive reading is at
 * least half a second clear of the refreshed one however long the dive takes, and
 * the running inversion cannot expire before the crossing, since
 * {@link CROSSING_TICKS} stops the sweep half a second short of PARTIAL. A
 * scenario whose posed inversion ran out would be watching a FIRST trigger rather
 * than a refresh, and would pass a build that never refreshes anything.
 */
const PARTIAL = 0.9 * INVERSION_TIME;

/**
 * How far above `PRISM_INVERT_Y` the diving Prism is posed, in logical units.
 *
 * Just over its own contact half-extent, `PRISM_HALF` (`28`, specs/drones.md), so
 * its centre starts clear above the line rather than already across it, and the
 * dive has a real crossing to make.
 */
const ABOVE_LINE = 30;

/**
 * Frames the dive is allowed to carry the Prism across the line.
 *
 * Four seconds of the harness's 100 Hz clock. specs/swarm.md fixes only the speed
 * along a dive's path (`DIVE_SPEED` `300`, times `droneSpeedScale(1)` = 1) and
 * leaves the path itself to the build — "a smooth swooping path of your design"
 * that bends toward the ship's current `x` — so the {@link ABOVE_LINE}-unit
 * descent to the line can cost a build many times that in travel. Four seconds is
 * {@link DIVE_REACH} units of path for that descent, and it still stops the sweep
 * half a second before the posed inversion could expire.
 */
const CROSSING_TICKS = 400;

/** How far a dive travels in {@link CROSSING_TICKS}, in logical units. */
const DIVE_REACH = seconds(CROSSING_TICKS) * DIVE_SPEED;

/**
 * Seconds of slack on the refreshed reading.
 *
 * Five frames of the harness's 100 Hz clock: enough for a build that spends the
 * crossing frame's own countdown out of the fresh time, and nine times narrower
 * than the nearest additive reading (`INVERSION_TIME + PARTIAL` at best, half a
 * second above).
 */
const REFRESH_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the running inversion back to INVERSION_TIME rather than adding to it", async () => {
  startPosed(h);
  h.debug.setInversion(PARTIAL);

  const posed = h.snapshot();
  assertEqual(posed.inversionActive, true, "the inversion the scenario posed");
  assertEqual(
    posed.isChallenge,
    false,
    "a standard stage, where a Prism dives",
  );

  poseDrone(h, "prism", FORM_CENTER_X, PRISM_INVERT_Y - ABOVE_LINE, {
    band: "cyan",
    phase: "diving",
    shell: true,
    travel: true,
  });

  const refreshed = await h.until((s) => s.inversion > PARTIAL, {
    maxFrames: CROSSING_TICKS,
  });
  captureStill(h, "refreshed");

  assertEqual(
    refreshed.hit,
    true,
    `the diving Prism crossing PRISM_INVERT_Y ${PRISM_INVERT_Y} raising the ` +
      `running inversion above the ${PARTIAL} s it was posed with, inside ` +
      `${DIVE_REACH} units of dive path (specs/drones.md)`,
  );
  assertBetween(
    refreshed.snapshot.inversion,
    INVERSION_TIME - REFRESH_TOLERANCE,
    INVERSION_TIME + REFRESH_TOLERANCE,
    `the seconds left after a fresh trigger, which sets the time back to ` +
      `INVERSION_TIME ${INVERSION_TIME} rather than adding to the ${PARTIAL} ` +
      `already running (specs/bands.md)`,
  );
});
