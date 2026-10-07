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
// run — so it reconstructs BOTH readings and takes the nearer: where the snapshot
// says the round is, and where it stood one tick of its own reported velocity
// earlier. specs/simulation.md advances a position by the velocity the same tick
// left it with, so the second is exact rather than approximate, and a build is
// judged on the launch point it actually chose under either convention. A build
// that spawns its round anywhere but the nose fails under both.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { DEG, KEY_FIRE, SHIP_R, TICK_DT } from "../constants";
import {
  componentAlong,
  magnitude,
  shortestDelta,
  unitAt,
  wrap,
} from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * Where the ship is posed, and which way it faces.
 *
 * Clear of the star's whole drawn extent and 468 units from its centre, so the
 * well's pull over the one tick this check runs is `MU / 468^2 x TICK_DT`, about
 * `0.17` units per second — nothing that can move a position by a tenth of a
 * unit. The facing is off both axes and 55 degrees away from the bearing to the
 * star from here, so "ahead along the facing" is a direction nothing else in the
 * scenario points in.
 */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/**
 * How far past `SHIP_R` the round's distance from the centre may read.
 *
 * One logical unit. The specification's bound is `SHIP_R` (`14`) exactly and this
 * is not room on that figure: it covers the arithmetic of reconstructing a launch
 * point from a reported position and velocity, and it is far smaller than the
 * `34`-unit ship whose nose is being located.
 */
const REACH_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts a fired round at the ship's nose, ahead of it along its facing", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_X, SHIP_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACING);
  await h.debug.setFireCooldown(0);

  await h.tap(KEY_FIRE);
  const after = await h.snapshot();
  // The round at the instant it left the ship.
  await captureStill(h, "muzzle");

  assertLength(
    after.bullets,
    1,
    "one press of the fire key to take exactly one shot " +
      "(specs/controls.md, specs/weapons.md)",
  );

  const shot = after.bullets[0];
  const centre = { x: SHIP_X, y: SHIP_Y };
  const facing = unitAt(FACING);

  // Where the round stands, and where it stood one tick of its own velocity
  // earlier: the two launch points the tick order leaves open.
  const candidates = [
    { at: { x: shot.x, y: shot.y }, when: "as the snapshot reports it" },
    {
      at: wrap({
        x: shot.x - shot.vx * TICK_DT,
        y: shot.y - shot.vy * TICK_DT,
      }),
      when: "one tick of its own velocity earlier",
    },
  ].map((candidate) => {
    const delta = shortestDelta(centre, candidate.at);
    return {
      when: candidate.when,
      reach: magnitude(delta),
      ahead: componentAlong(delta, facing),
    };
  });
  const launch = candidates.reduce((best, one) =>
    one.reach < best.reach ? one : best,
  );

  assertGreaterThan(
    launch.ahead,
    0,
    `the round's launch point ahead of the ship's centre along its facing, ` +
      `in units along that facing (specs/weapons.md: the launch position is ` +
      `the ship's nose, ahead of the centre along the facing); read ` +
      `${launch.when}`,
  );
  assertLessThanOrEqual(
    launch.reach,
    SHIP_R + REACH_SLACK,
    `the round's launch point no further than SHIP_R (${SHIP_R}) from the ` +
      `ship's centre, in units (specs/weapons.md); read ${launch.when}`,
  );
});
