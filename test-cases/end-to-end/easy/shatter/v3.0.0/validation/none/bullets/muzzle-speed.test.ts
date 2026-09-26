// bullets/muzzle-speed — a round leaves at the muzzle speed, along the facing.
//
// specs/weapons.md, "The gun", the Launch velocity row: "The ship's current
// velocity plus `MUZZLE_SPEED` (`520`) along the ship's facing." From a ship at
// REST the first term is zero, so the whole of the launch velocity is
// `MUZZLE_SPEED` along the facing — one vector the specification fixes exactly,
// and the one this item decides.
//
// WHAT IS MEASURED. The distance between the velocity the snapshot reports for
// the round and the vector `520 x (cos FACING, sin FACING)`, held against 2
// percent of `MUZZLE_SPEED`. A vector difference rather than a speed, because
// "`520` along the ship's facing" fixes a direction as well as a magnitude, and a
// build that launched at the right speed on the wrong heading is not conforming.
// One reading decides both, in the units the figure is quoted in.
//
// AND WHY EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build launching at the
// ship's own maximum speed (`SHIP_MAX`, `680`) is `160` out; one launching at the
// saucer's bullet speed (`300`) is `220` out; one launching along the field's
// axes rather than along the facing is at least `300` out at this facing. The
// bound is `10.4`.
//
// THE SHIP IS AT REST, OFF EVERY AXIS, AND FAR FROM THE STAR. At rest so the
// ship's own velocity contributes nothing that has to be modelled — the drift
// term is `bullets/inherits-ship-velocity`'s item, not this one. Off every axis
// so a build that ignores the facing cannot pass. Far from the star so the well,
// which does pull a bullet (specs/gravity.md), cannot move the reading: at this
// pose the pull is `MU / 468^2`, and over the single tick between the press and
// the reading that is `0.17` units per second, one sixtieth of the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual, assertCloseTo } from "../assert";
import { DEG, KEY_FIRE, MUZZLE_SPEED } from "../constants";
import { magnitude, scale, subtract, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";

/** Where the ship is posed, and which way it faces. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/**
 * How far the launch velocity may fall from the specified vector, in units per
 * second.
 *
 * 2 percent of `MUZZLE_SPEED`, which is the figure the review item states. It is
 * a tolerance on a value the specification fixes exactly, so it is room for a
 * build's own arithmetic and for the sixth of a unit per second the well adds
 * over the launch tick — not room on the figure itself.
 */
const SPEED_TOLERANCE = 0.02 * MUZZLE_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("launches a round at MUZZLE_SPEED along the ship's facing", async () => {
  await startPlaying(h);
  await h.debug.setShipPosition(SHIP_X, SHIP_Y);
  await h.debug.setShipVelocity(0, 0);
  await h.debug.setShipAngle(FACING);
  await h.debug.setFireCooldown(0);

  const posed = await h.snapshot();
  assertCloseTo(
    posed.ship.speed,
    0,
    3,
    "the ship at rest before the shot, so the whole launch velocity is the " +
      "muzzle term (specs/weapons.md)",
  );

  await h.tap(KEY_FIRE);
  const after = await h.snapshot();
  // The round at the instant it left.
  await captureStill(h, "muzzle");

  assertLength(
    after.bullets,
    1,
    "one press of the fire key to take exactly one shot " +
      "(specs/controls.md, specs/weapons.md)",
  );

  const wanted = scale(unitAt(FACING), MUZZLE_SPEED);
  const drift = magnitude(subtract(velocityOf(after.bullets[0]), wanted));

  assertLessThanOrEqual(
    drift,
    SPEED_TOLERANCE,
    `the round's launch velocity within ${SPEED_TOLERANCE} units per second ` +
      `of MUZZLE_SPEED (${MUZZLE_SPEED}) along the ship's facing, which at ` +
      `this facing is (${wanted.x.toFixed(1)}, ${wanted.y.toFixed(1)}) ` +
      `(specs/weapons.md); measured as the length of the difference`,
  );
});
