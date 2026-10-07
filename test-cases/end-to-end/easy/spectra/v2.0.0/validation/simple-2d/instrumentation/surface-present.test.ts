// instrumentation/surface-present — the debug surface is there, whole, and wired
// to the running game.
//
// specs/instrumentation.md: "You implement it. Every operation this file
// specifies is a deliverable, and the build's `initialize` returns the finished
// surface beside the state it built, as the pair `[state, debug]`. The engine
// returns that same value from `engine.debug`, and it is reached that way alone:
// nothing is installed on the page." It carries "`version`
// (`SPECTRA_DEBUG_VERSION`, `1`), a plain number, and the operations below".
//
// THREE READINGS, AND EACH DECIDES A DIFFERENT FAILURE.
//
// 1. THE SURFACE IS THERE. `engine.debug` holds whatever the build returned as
//    the second element of its pair, so reading it is the whole check: there is
//    no page property to look for and nothing this suite could have supplied in
//    the build's place.
// 2. IT IS WHOLE. `version` reports `SPECTRA_DEBUG_VERSION`, and every operation
//    the specification names is a function on it. `REQUIRED_OPS` in `surface.ts`
//    is that list, in the order specs/instrumentation.md prints it.
//    `setDroneCharge` is deliberately not on it: that operation belongs to the
//    overload variant alone, and `overload/*` is where a build is held to it.
// 3. IT IS LIVE. An object of the right shape that is not connected to the
//    running game is the failure worth naming, because every other point on this
//    checklist poses its scenario through this surface and would fail for reasons
//    that name the wrong thing. So a drone is posed and read back off `snapshot`,
//    and the ship — placed by a pose — is then driven by the engine's own input
//    and has moved. A surface reporting a plausible object unconnected to the
//    field fails on one or the other.
//
// WHAT THIS DOES NOT DECIDE. How fast the ship travels, which is `ship/*`'s: this
// point asks only that the pose reached the game the key drives.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_SPEED, SPECTRA_DEBUG_VERSION } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneOf,
  holdFor,
  lastDrone,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "../surface";

/**
 * Where the posed drone stands, in logical units.
 *
 * Geometry, not a threshold: well inside the play field (`y` in `[64, 656]`,
 * specs/field.md), clear of both HUD strips and far above the ship's lane at
 * `SHIP_Y` (`600`), so nothing the ship does while it is driven can reach it.
 */
const DRONE_X = 420;
const DRONE_Y = 260;

/**
 * How closely the drone's reported centre must match the one it was posed at, in
 * decimal digits for `assertCloseTo`.
 *
 * Six, which is half a millionth of a logical unit. `addDrone` "adds one drone of
 * `kind` ... with its center at a logical stage position" and every faculty
 * `poseDrone` leaves off holds it exactly there, so a conforming build reports
 * the two numbers it was handed back unchanged: this is float noise, not an
 * allowance for drift. It is the figure the same point uses under the other two
 * engines, because what a pose reads back as belongs to the case rather than to
 * the runtime.
 */
const PLACED_DIGITS = 6;

/** How long the direction key is held, in frames of the suite's clock. */
const HOLD_TICKS = ticksFor(0.25);

/**
 * The least ground the ship must have covered, in logical units.
 *
 * `SHIP_SPEED` (`360`) over the quarter second held is `90` units, and the lane
 * runs to `SHIP_X_MAX` (`1240`), so a conforming ship travels the whole `90` from
 * the centre of its lane with room to spare. The floor is a tenth of that: this
 * point asks that the posed ship ANSWERS the key, and how fast it travels is
 * `ship/*`'s to decide.
 */
const MOVED_MIN = (SHIP_SPEED * seconds(HOLD_TICKS)) / 10;

/** The first key specs/controls.md binds the `right` action to. */
const RIGHT_KEY = BINDINGS.right[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a whole, live debug surface beside its state", async () => {
  // 1. There. `engine.debug` is the value the build's `initialize` returned as
  // the second element of `[state, debug]`, unchanged and unwrapped.
  const api = h.engine.debug as unknown as Record<string, unknown>;
  assertNotNull(
    api,
    "engine.debug holds the surface src/game.ts's initialize returned beside " +
      "its state, as [state, debug] (specs/instrumentation.md)",
  );
  assertEqual(
    typeof api,
    "object",
    "engine.debug holds the surface the build returned (specs/instrumentation.md)",
  );

  // 2. Whole.
  assertEqual(
    typeof api.version,
    "number",
    "version is a plain number on the surface (specs/instrumentation.md)",
  );
  assertEqual(
    api.version,
    SPECTRA_DEBUG_VERSION,
    "the version the surface reports (SPECTRA_DEBUG_VERSION, " +
      `${String(SPECTRA_DEBUG_VERSION)}, specs/instrumentation.md)`,
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `${op} is an operation specs/instrumentation.md names, so it is a ` +
        "function on the surface",
    );
  }

  // 3. Live. An empty, quiet, live wave, so the only things on the field are the
  // drone this poses and the ship no scenario can remove.
  startPosed(h);
  const droneId = poseDrone(h, "prism", DRONE_X, DRONE_Y);
  const placed = droneOf(h.snapshot(), droneId);

  h.debug.setShipX(LANE_CENTER);
  const from = h.snapshot().ship.x;
  await holdFor(h, RIGHT_KEY, HOLD_TICKS);
  const to = h.snapshot().ship.x;
  captureStill(h, "live");

  assertEqual(
    lastDrone(h.snapshot()).id,
    droneId,
    "the drone addDrone appended is the last of the roster, which is how its " +
      "id is read (specs/instrumentation.md)",
  );
  assertEqual(
    placed.kind,
    "prism",
    `the kind snapshot reports for the drone addDrone("prism", …) appended — ` +
      `"shard" is what a build that ignores the kind argument reports`,
  );
  assertCloseTo(
    placed.x,
    DRONE_X,
    PLACED_DIGITS,
    "the x snapshot reports for the drone addDrone was handed",
  );
  assertCloseTo(
    placed.y,
    DRONE_Y,
    PLACED_DIGITS,
    "the y snapshot reports for the drone addDrone was handed",
  );
  assertCloseTo(
    from,
    LANE_CENTER,
    PLACED_DIGITS,
    "the x snapshot reports for the ship setShipX placed at the centre of its " +
      "lane (specs/instrumentation.md)",
  );
  assertGreaterThan(
    to - from,
    MOVED_MIN,
    `logical units the ship covered to the right over ${String(HOLD_TICKS)} ` +
      `frames with the ${String(RIGHT_KEY)} key held, from the x a pose put ` +
      "it at — the surface poses the game the engine's own input drives " +
      "(specs/instrumentation.md, specs/ship.md)",
  );
});
