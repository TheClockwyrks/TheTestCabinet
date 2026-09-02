// overload/mismatch-charges — a wrong-band shot charges the drone it hits.
//
// specs/mode.md, under this mode, replaces what a mismatched shot is: "In Overload
// a wrong-band shot does not go to waste: it feeds the drone it hits, charging it
// toward an overload that makes it more dangerous", and fixes the arithmetic —
// "A mismatched shot into a drone below `OVERLOAD_AT - 1` adds `1` charge to it."
// A drone is created at charge `0` (specs/instrumentation.md gives `addDrone` a
// drone at charge `0`), so one mismatched shot into a fresh drone leaves it at
// charge `1`.
//
// THE SHOT IS REAL. Nothing here poses a charge on the way in: the drone is posed
// at the charge `addDrone` gives it, one of the player's bullets of the opposite
// band is put in flight below it, and the build's own contact and band rules
// decide what the contact does. The charge is READ afterwards.
//
// A SHARD IS THE DRONE, deliberately. Its band is fixed for its life
// (specs/drones.md), it has no shell and no shimmer, and with no inversion running
// its effective band is its stored band — so the shot's band is a mismatch by the
// one rule specs/bands.md states and by nothing else. The kinds' reactions are the
// business of the three reaction points below.
//
// THE WORLD IS ONE SHARD AND ONE SHOT. `startPosed` empties the three rosters and
// shuts the three world gates, and the Shard is posed as a PROP with all three of
// its faculties off, so nothing enters, nothing dives, nothing fires and nothing
// reaches the ship while the bullet is in the air.
//
// THE VERDICT IS THE PAIR — alive at charge 1. Alive is the half specs/bands.md
// governs ("The drone is not destroyed") and is what says the charge was fed to a
// drone the shot did not kill; the charge is this mode's own half. A build that
// destroys on a mismatch and one that charges nothing grade differently.
//
// WHAT THIS DOES NOT DECIDE. That a SECOND mismatch carries the charge on, which
// is `overload/charge-advances`; that the third overloads, which is
// `overload/overloads-at-three`; and that the shot pays nothing, which is
// `overload/mismatch-scores-nothing` and `overload/fills-no-resonance`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot, requireDrone } from "./charge";

/**
 * Where the target Shard stands, in logical units.
 *
 * Mid-field on the ship's own lane: well inside the play field on both axes
 * (`y` in `[64, 656]`, specs/field.md), clear of both HUD strips and far above the
 * ship's lane at `SHIP_Y` (`600`), with room under it for the shot's climb.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: `SHARD_HALF` (`14`, specs/drones.md) and
 * `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the contact reach, so the bullet starts well clear of the drone and
 * the contact the check reads is one the FLIGHT produced rather than one the
 * placement did.
 */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`, specs/ship.md) a bullet covers 7.6 units per
 * frame of the harness's 100 Hz clock, so it enters the contact reach 120 units
 * up, inside 16 frames. Thirty leaves fourteen frames of slack for whichever
 * sub-step a build resolves the contact on, and still stops the sweep short of the
 * top of the field.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a drone a wrong-band shot found alive at charge one", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, { band: "cyan" });

  assertEqual(
    chargeOf(
      requireDrone(h.snapshot(), target, "the shot's target"),
      "the freshly added Shard",
    ),
    0,
    "the charge `addDrone` gives a drone it adds (specs/instrumentation.md)",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "charged");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot placed ${String(SHOT_BELOW)} units below the ` +
      `stored-cyan Shard resolved inside the ${String(SHOT_FRAMES)} frames its ` +
      `climb at PLAYER_BULLET_SPEED ${String(PLAYER_BULLET_SPEED)} takes`,
  );
  assertEqual(
    chargeOf(
      requireDrone(
        shot.snapshot,
        target,
        "the drone a mismatched shot must leave standing (specs/bands.md)",
      ),
      "the drone the mismatched shot fed",
    ),
    1,
    "the charge a mismatched shot adds to a drone at charge 0 (specs/mode.md)",
  );
});
