// bullets/fires-from-the-nose — a round leaves from the ship's nose.
//
// specs/weapons.md, "The gun", the Launch position row: "The ship's nose: ahead
// of the ship's centre along its facing, and no further from it than `SHIP_R`
// (`14`)". Two requirements in one line, and this item reads both of them off
// one shot: the round appears AHEAD of the centre along the facing, and within
// the ship's own collision radius of it.
//
// THE SHIP IS AT REST AND OFF EVERY AXIS. A ship at rest cannot move between the
// pose and the reading, so the centre the round is measured from is the centre it
// was fired from. The facing is `-35` degrees, which is neither an axis nor the
// bearing from this pose to the star, so a build that spawns its round "above the
// ship" or "toward the middle of the field" rather than along the facing reads as
// a different number rather than passing by coincidence.
//
// WHY TWO CANDIDATE LAUNCH POINTS ARE ALLOWED. specs/simulation.md fixes the
// order of work inside a tick but does not say where in it the gun fires, so a
// conforming build may create the round before that tick's position step and let
// it fly one tick, or after it and leave it standing at the nose. The check
// cannot look inside a tick — the shot only exists once the tick that took it has
// run — so `launchCandidates` reconstructs BOTH readings and `launchReading`
// takes the nearer. The reconstruction is exact rather than approximate, for the
// reason gun.ts sets out. A build that spawns its round anywhere but the nose
// fails under both.
//
// THE WELL CANNOT MOVE THE READING. specs/ship.md exempts the ship from the
// star's pull entirely, and the round is `468` units from the star's centre,
// where specs/gravity.md gives it `MU / 468^2` — about `20` units per second
// squared, or `0.0014` of a unit over the single tick between the press and the
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_R } from "../constants";
import {
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { fireOnce, launchReading } from "./gun";

/** Where the ship is posed, and which way it faces. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/**
 * How far past `SHIP_R` the round's distance from the centre may read, in
 * logical units.
 *
 * One unit. The specification's bound is `SHIP_R` (`14`) exactly and this is not
 * room on that figure: it covers the arithmetic of reconstructing a launch point
 * from a reported position and velocity, and it is a fourteenth of the radius
 * whose nose is being located.
 */
const REACH_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts a fired round at the ship's nose, ahead of it along its facing", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);
  h.debug.setFireCooldown(0);

  await fireOnce(h);
  const after = h.snapshot();
  // The round leaving the ship's nose.
  captureStill(h, "muzzle");

  assertLength(
    after.bullets,
    1,
    "one press of the fire key to take exactly one shot " +
      "(specs/controls.md, specs/weapons.md)",
  );

  const launch = launchReading(
    after.bullets[0],
    { x: SHIP_X, y: SHIP_Y },
    FACING,
  );

  assertGreaterThan(
    launch.ahead,
    0,
    `the round's launch point ahead of the ship's centre along its facing, in ` +
      `units along that facing (specs/weapons.md: the launch position is the ` +
      `ship's nose, ahead of the centre along the facing); read ${launch.when}`,
  );
  assertLessThanOrEqual(
    launch.reach,
    SHIP_R + REACH_SLACK,
    `the round's launch point no further than SHIP_R (${SHIP_R}) from the ` +
      `ship's centre, in units (specs/weapons.md); read ${launch.when}`,
  );
});
