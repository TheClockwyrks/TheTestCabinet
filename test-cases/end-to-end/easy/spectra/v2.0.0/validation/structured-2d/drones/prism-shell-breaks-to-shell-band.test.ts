// drones/prism-shell-breaks-to-shell-band — the shell falls to the shell's band.
//
// specs/drones.md, Its two layers: with the shell intact the exposed layer is the
// shell, "Broken by | A shot whose effective band matches the shell's", and
// "Breaking the shell leaves the Prism alive with its core exposed". That is the
// first of the two hits a Prism costs, and it is what makes the kind a two-beat
// problem: the player must land the shell's band and then the other one.
//
// WHAT IS DRIVEN. One Prism alone in mid-field, every faculty off — a target and
// nothing else — with its stored band posed MAGENTA. specs/instrumentation.md fixes
// what that means: "For a Prism it is the shell's band, and the core's is always
// the opposite." One of the player's bullets is placed well below it carrying
// magenta and left to climb, and the build's own contact and band rules decide the
// rest.
//
// MAGENTA IS THE DISTINGUISHING VALUE. `addDrone` creates a drone holding cyan, so
// posing magenta separates every wrong model this point can be failed by: a build
// that breaks the shell on the CORE's band spares it here, a build that matches
// against a default cyan spares it here, and a build that destroys the whole Prism
// on one hit leaves no drone to read.
//
// The other three cells of the two-by-two are their own points:
// `drones/prism-shell-survives-mismatch` fires the core's band into this same
// scenario, and `drones/prism-core-survives-shell-band` and
// `drones/prism-core-destroys` fire both bands into the same Prism with its shell
// already gone. Nothing is destroyed here, so nothing clears the stage.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, PLAYER_BULLET_SPEED } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { requireDrone } from "./roster";

/** The Prism's stored band, which specs/instrumentation.md makes the SHELL's. */
const SHELL_BAND = "magenta" as const;

/**
 * Where the target Prism stands.
 *
 * Mid-field on the ship's own lane: clear of both HUD strips (`FIELD_TOP` `64`,
 * `FIELD_BOTTOM` `656`) and of `SHIP_Y` (`600`), with room below it for a flight
 * that starts outside the drone's reach.
 */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * Geometry, not a tolerance. A shelled Prism's contact reach against one of the
 * player's bullets is `PRISM_HALF` (`28`) plus `PLAYER_BULLET_HALF` (`6`) = `34`
 * units of centre separation, so `200` starts the bullet nearly six times clear of
 * it: the contact the check reads is one the flight produced, not one the placement
 * did.
 */
const SHOT_BELOW = 200;

/**
 * Frames the shot is flown for.
 *
 * The climb of `SHOT_BELOW` at `PLAYER_BULLET_SPEED` (`760`, specs/ship.md), which
 * carries the bullet's centre onto the drone's and runs every frame of the approach
 * through the build's own collision code.
 */
const FLIGHT_TICKS = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED);

/**
 * What a missing drone would mean here.
 *
 * Breaking a shell "leaves the Prism alive with its core exposed", so a roster that
 * no longer holds the id is the build that destroyed the whole Prism on one hit —
 * which is this rule broken, not a reading that came back empty.
 */
const ALIVE =
  "the Prism left alive with its core exposed by the shot that broke its shell " +
  "(specs/drones.md)";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("breaks a Prism's shell with a shot of the shell's band, leaving it alive", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const prism = poseDrone(h, "prism", AT.x, AT.y, {
    band: SHELL_BAND,
    shell: true,
  });

  await fireAt(h, AT.x, AT.y, SHELL_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "broken");

  const after = requireDrone(h.snapshot(), prism, ALIVE);
  assertEqual(
    after.shellAlive,
    false,
    `the shell a ${SHELL_BAND} shot broke off a ${SHELL_BAND}-shelled Prism, ` +
      "leaving it alive with its core exposed (specs/drones.md)",
  );
});
