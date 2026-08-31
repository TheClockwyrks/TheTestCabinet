// overload/mismatch-charges — a wrong-band shot charges the drone it hits.
//
// specs/mode.md, under this mode, replaces what a mismatched shot is: "In Overload
// a wrong-band shot does not go to waste: it feeds the drone it hits, charging it
// toward an overload that makes it more dangerous", and fixes the arithmetic — "A
// mismatched shot into a drone below `OVERLOAD_AT - 1` adds `1` charge to it." A
// drone is created at charge `0` (specs/instrumentation.md gives `addDrone` a drone
// at charge `0`), so one mismatched shot into a fresh drone leaves it at charge `1`.
//
// THE SHOT IS REAL. Nothing here poses a charge on the way in: the drone is posed at
// the charge `addDrone` gives it, one of the player's bullets of the opposite band is
// put in flight below it, and the build's own contact and band rules decide what the
// contact does. The charge is READ afterwards.
//
// A SHARD IS THE DRONE, deliberately. Its band is fixed for its life
// (specs/drones.md), it has no shell and no shimmer, and with no inversion running
// its effective band is its stored band — so the shot's band is a mismatch by the one
// rule specs/bands.md states and by nothing else. The kinds' reactions are the
// business of the three reaction points below.
//
// THE VERDICT IS THE PAIR — alive at charge 1. Alive is the half specs/bands.md
// governs ("The drone is not destroyed") and is what says the charge was fed to a
// drone the shot did not kill; the charge is this mode's own half. A build that
// destroys on a mismatch and one that charges nothing grade differently.
//
// WHAT THIS DOES NOT DECIDE. That a SECOND mismatch carries the charge on, which is
// `overload/charge-advances`; that the third overloads, which is
// `overload/overloads-at-three`; and that the shot pays nothing, which is
// `overload/mismatch-scores-nothing` and `overload/fills-no-resonance`.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_CENTER_X, SHARD_HALF } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot } from "./charge";

/**
 * Where the target Shard stands.
 *
 * Mid-field on the formation's own centre line: clear of both HUD strips
 * (`FIELD_TOP` 64, `FIELD_BOTTOM` 656) and well above `SHIP_Y` (600), with room
 * under it for the shot's climb.
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * A Shard's contact reach against one of the player's bullets is `SHARD_HALF` (14)
 * + `PLAYER_BULLET_HALF` (6) = 20 units of centre separation, so 140 places the
 * bullet seven times clear of it: the contact the check reads is one the flight
 * produced, not one the placement did. `fireAt` derives the frames from the gap, so
 * the climb is exactly the frames `PLAYER_BULLET_SPEED` needs to cover it.
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a drone a wrong-band shot found alive at charge one", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET.x, TARGET.y, { band: "cyan" });

  assertEqual(
    chargeOf(droneOf(h.snapshot(), target), "the freshly added Shard"),
    0,
    "the charge `addDrone` gives a drone it adds (specs/instrumentation.md)",
  );

  const shot = await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "charged");

  const hit = findDrone(h.snapshot(), target);
  assertNotNull(
    hit,
    `the cyan Shard still on the field after a ${shot.band} bullet climbed ` +
      `${String(SHOT_BELOW)} units into its ${String(SHARD_HALF)}-unit contact ` +
      "circle — specs/bands.md: a bullet whose effective band is the opposite of " +
      "the drone's does not destroy it",
  );
  assertEqual(
    chargeOf(
      droneOf(h.snapshot(), target),
      "the drone the mismatched shot fed",
    ),
    1,
    "the charge a mismatched shot adds to a drone at charge 0 (specs/mode.md)",
  );
});
