// instrumentation/surface-present — the debug and automation surface the build
// returns is there, is whole, and is wired to the running game rather than to a
// plausible-looking object.
//
// specs/instrumentation.md makes the surface a deliverable: "the game instance's
// `initialize` returns the finished surface. The engine holds it and returns it
// from `engine.debug`, and it is reached that way alone", and "Every scenario
// driven from code reaches the game through it, so it is present and exactly as
// specified here". It carries `version` (`SPECTRA_DEBUG_VERSION`, `1`) and every
// operation that file names — which under this engine does NOT include the two
// clock operations `setAutoStep` and `advance`, because "The clock, the keyboard,
// the audio bus, and the overlay belong to the structured-2d engine… and the
// surface carries no operation for any of them". `surface.ts`'s `REQUIRED_OPS` is
// that list. So the first half of this check is reflection: each operation is
// present, as a function, under the name the specification gives it, and the
// version reads `1`.
//
// THE SECOND HALF IS THE ONE THAT MATTERS. A surface that answers every call and
// reports a state unconnected to the game passes reflection and then fails every
// other point in this suite for reasons that name the wrong mechanic. So two poses
// are driven and read back through the game itself: `addDrone` puts a Prism on the
// field and `snapshot` reports that Prism where it was put, and `setShipX` places
// the ship somewhere it was not, after which a held key moves it — which only the
// build's own registered actions and its own tick can do.
//
// THE POSED KIND AND POSITION ARE THE DISTINGUISHING ONES. `addDrone` takes the
// kind as its first argument (specs/instrumentation.md, The drones), so a build
// that appends a drone and ignores that argument reads `shard`, one that ignores
// the position reads the drone somewhere else, and one that appended nothing reads
// an empty roster. Each wrong model reads as a different answer.
//
// A BUILD THAT RETURNED NO SURFACE IS NAMED HERE. `harness.ts` reads `engine.debug`
// and stands a failing proxy in its place when what it holds is no object, so the
// first reach below reports the missing return rather than a `TypeError`.
//
// WHAT THIS DOES NOT DECIDE. Not the ship's speed: the drive below is a quarter of
// a second and the only reading taken from it is that the ship ended to the RIGHT
// of where it was posed, so a build whose ship is far slower than `SHIP_SPEED`
// still passes here and is graded on the figure by `ship.moves-right` and its
// siblings. Not which key does it either — `controls.right-arrow` grades the
// binding — nor that any other pose lands, which is
// `instrumentation.poses-read-back`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  BINDINGS,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
} from "../../src/constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { REQUIRED_OPS, SPECTRA_DEBUG_VERSION } from "../surface";
import { requireDrone } from "./crowded-field";

/** Where the posed Prism stands: mid-field, clear of both HUD strips and the ship. */
const PRISM_AT = { x: 300, y: 420 } as const;

/**
 * Where the ship is posed, in logical units along its lane.
 *
 * `500`, which is neither the centre of the lane (`640`) `startPosed` leaves it
 * at nor either bound, and comfortably inside `[SHIP_X_MIN, SHIP_X_MAX]`
 * (`[40, 1240]`), so the lane's clamp has nothing to do and the reading is of the
 * pose alone.
 */
const SHIP_AT = 500;

/**
 * How far a reading of a posed position may sit from the value posed, in decimal
 * digits for `assertCloseTo`.
 *
 * Six, which is half a millionth of a logical unit: the specification names one
 * exact point in each case and this is the float noise of reading a number back
 * out of the running game, not an allowance for drift.
 */
const POSE_DIGITS = 6;

/** How long the movement key is held, in seconds. */
const HELD_SECONDS = 0.25;

/**
 * How far right of its posed `x` the ship must end, in logical units.
 *
 * One unit. specs/ship.md travels the ship at `SHIP_SPEED` (`360`) units per
 * second, so the quarter-second below is `90` units for a build that keeps to the
 * figure — but the reading this point wants is only that the surface poses a game
 * the build's own input and tick then move, so the bar is set where float noise
 * ends rather than where the specification's speed is.
 */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries every documented operation and drives the running game", async () => {
  // Reflection through reads that invoke nothing, so a build missing one
  // operation is told which one — and a build that returned no surface at all is
  // named by the harness at the first reach.
  const surface = h.debug as unknown as Record<string, unknown>;
  assertEqual(
    surface.version,
    SPECTRA_DEBUG_VERSION,
    `engine.debug.version, which specs/instrumentation.md fixes as ` +
      `SPECTRA_DEBUG_VERSION (${SPECTRA_DEBUG_VERSION})`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof surface[op],
      "function",
      `typeof engine.debug.${op}, an operation specs/instrumentation.md ` +
        `requires on the surface under this engine`,
    );
  }

  // An empty, quiet, live wave: nothing on it but the drone posed below.
  startPosed(h);

  const id = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y);
  h.debug.setShipX(SHIP_AT);

  // Read with no frame between: a pose acts on the live game at the moment of the
  // call under this engine, so nothing stands between the poses and the readings.
  const posed = h.snapshot();
  assertLength(
    posed.drones,
    1,
    `the drones on the field after addDrone("prism", ${PRISM_AT.x}, ` +
      `${PRISM_AT.y}) on an emptied roster`,
  );
  const prism = requireDrone(posed, id, "the drone addDrone appended");
  assertEqual(
    prism.kind,
    "prism",
    `the kind snapshot() reports for the drone addDrone("prism", …) appended — ` +
      `"shard" is what a build that ignores the kind argument reports`,
  );
  assertCloseTo(
    prism.x,
    PRISM_AT.x,
    POSE_DIGITS,
    `the centre x snapshot() reports for that drone`,
  );
  assertCloseTo(
    prism.y,
    PRISM_AT.y,
    POSE_DIGITS,
    `the centre y snapshot() reports for that drone`,
  );
  assertCloseTo(
    posed.ship.x,
    SHIP_AT,
    POSE_DIGITS,
    `the ship's centre x after setShipX(${SHIP_AT}), which is inside ` +
      `[SHIP_X_MIN, SHIP_X_MAX] ([${SHIP_X_MIN}, ${SHIP_X_MAX}]) so the lane's ` +
      `clamp has nothing to do`,
  );

  // And the build's own registered actions and tick move the ship the surface
  // placed.
  await holdActionFor(h, "right", ticksFor(HELD_SECONDS));
  const driven = h.snapshot();
  // Before the assertion, so a failing drive still leaves the picture of the
  // posed drone and the ship beside it.
  captureStill(h, "live");

  assertGreaterThan(
    driven.ship.x,
    SHIP_AT + MOVED_MIN,
    `the ship's centre x after ${HELD_SECONDS} s with ${BINDINGS.right[0]} ` +
      `held, from the ${SHIP_AT} it was posed at — the surface poses a game ` +
      `the build's own input and tick run from there, at SHIP_SPEED ` +
      `(${SHIP_SPEED}) units per second (specs/instrumentation.md, ` +
      `specs/ship.md)`,
  );
});
