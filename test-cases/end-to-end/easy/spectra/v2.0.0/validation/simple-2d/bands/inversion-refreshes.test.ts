// bands/inversion-refreshes — a second trigger refreshes the inversion.
//
// specs/bands.md, "The spectral inversion": "At most one inversion is active at a
// time. A fresh trigger while one is running sets the remaining time back to
// `INVERSION_TIME` rather than adding to it." So the number this point reads is
// the seconds remaining just after a second trigger lands on a running
// inversion: `INVERSION_TIME`, and emphatically not `INVERSION_TIME` plus what
// was left.
//
// THE TRIGGER IS A REAL DIVING PRISM, never a second `setInversion`. specs/
// drones.md fixes the trigger — "When a diving Prism with a layer still intact
// has its center cross `PRISM_INVERT_Y` (`640`) traveling downward, it triggers a
// spectral inversion" — and `setInversion` is the operation that POSES remaining
// time. Calling it twice would satisfy the refresh rule by that operation's own
// contract whatever the build's trigger does, which decides nothing about the
// build. So `setInversion` appears once, as the PRECONDITION — the inversion
// already running — and the Prism is what refreshes it.
//
// THE PRECONDITION IS A PARTIAL INVERSION, {@link POSED_REMAINING} seconds, well
// inside `0 < t < INVERSION_TIME`. The value is what separates every wrong model:
// a build that adds reads about `INVERSION_TIME + t`, one that ignores a second
// trigger while one runs reads about `t` less the dive, and one that refreshes
// correctly reads `INVERSION_TIME`. All three are far apart.
//
// THE PRISM IS POSED WITH TRAVEL ALONE, diving from just above the line. Its
// firing is off, so no enemy bullet enters the scenario, and its band clock is
// off because a Prism has none. Its shell is left intact, which is the "layer
// still intact" specs/drones.md requires of a crossing that inverts.
//
// THE APPROACH IS SHORT — {@link APPROACH} units, a fifth of a second at
// `DIVE_SPEED` — because specs/swarm.md leaves a dive's exact path to the build.
// The nearer the line the Prism starts, the less of that unstated path this
// reading rests on, and the crossing itself is all this point needs from it.
//
// THE SHIP'S CONTACT TEST STAYS OFF, as `startPosed` leaves it, so a Prism
// pressing down through the ship's lane on its way to the line costs nothing and
// ends no wave.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  INVERSION_TIME,
  PRISM_INVERT_Y,
} from "../../src/constants";
import { assertBetween, assertTrue } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The seconds of inversion already running when the Prism crosses. */
const POSED_REMAINING = 1;

/** How far above PRISM_INVERT_Y the diving Prism starts, in logical units. */
const APPROACH = 60;

/** Where it dives: the ship's own lane position, so the dive's aim is straight. */
const PRISM_X = LANE_CENTER;

/**
 * How long the Prism is given to reach its line, in frames of the 120 Hz clock.
 *
 * `1.5` s. At `DIVE_SPEED` (`300`) the `APPROACH` (`60`) units take `0.2` s, so
 * the sweep runs seven times past it and a build whose dive is slower than the
 * stated speed still crosses inside it.
 */
const SWEEP_TICKS = ticksFor(1.5);

/**
 * How far the reading may sit from `INVERSION_TIME`, in seconds.
 *
 * `0.05` s, one percent of the figure. The sweep samples once a frame, so the
 * reading is taken at most one frame of the 120 Hz clock (`0.0083` s) after the
 * crossing, and a build may count that frame's delta off the fresh time before
 * reporting it. The band is far too narrow to admit the `INVERSION_TIME +
 * POSED_REMAINING` a build that ADDED would report, which is a whole second out.
 */
const TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets a running inversion back to INVERSION_TIME rather than adding to it", async () => {
  startPosed(h);
  h.debug.setInversion(POSED_REMAINING);
  poseDrone(h, "prism", PRISM_X, PRISM_INVERT_Y - APPROACH, {
    phase: "diving",
    travel: true,
  });

  // The posed inversion only counts down, so the first reading above it is the
  // Prism's crossing having set a fresh one.
  const swept = await h.until((field) => field.inversion > POSED_REMAINING, {
    maxFrames: SWEEP_TICKS,
  });
  captureStill(h, "refreshed");

  assertTrue(
    swept.hit,
    `a diving Prism crossing PRISM_INVERT_Y ${PRISM_INVERT_Y} triggered an ` +
      `inversion within ${SWEEP_TICKS} frames (${seconds(SWEEP_TICKS)} s) of ` +
      `starting ${APPROACH} units above it at DIVE_SPEED ${DIVE_SPEED} — ` +
      "specs/drones.md: a diving Prism with a layer still intact triggers a " +
      "spectral inversion as its centre crosses that line",
  );
  assertBetween(
    swept.snapshot.inversion,
    INVERSION_TIME - TOLERANCE,
    INVERSION_TIME + TOLERANCE,
    `the seconds of inversion left in the frame a diving Prism crossed ` +
      `PRISM_INVERT_Y with ${POSED_REMAINING} s of an earlier inversion still ` +
      `running — specs/bands.md: a fresh trigger sets the remaining time back ` +
      `to INVERSION_TIME ${INVERSION_TIME} rather than adding to it, so ` +
      `${INVERSION_TIME + POSED_REMAINING} is a build that added and ` +
      `${POSED_REMAINING} is one that let the running inversion stand`,
  );
});
