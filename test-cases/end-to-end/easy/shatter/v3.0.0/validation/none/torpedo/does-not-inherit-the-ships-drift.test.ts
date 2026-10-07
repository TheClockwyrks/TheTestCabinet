// torpedo/does-not-inherit-the-ships-drift — a torpedo carries none of the ship's
// motion.
//
// specs/weapons.md, "The launch": a torpedo "is self-propelled and carries none of
// the ship's drift, so its velocity at launch is `TORPEDO_SPEED` (`420`) along that
// heading and nothing else." That is the one line the gun contradicts on purpose:
// specs/weapons.md launches a BULLET at "the ship's current velocity plus
// `MUZZLE_SPEED` along the ship's facing", so a build that reuses its gun's muzzle
// code for the torpedo is the failure this item exists to catch.
//
// THE DRIFT IS ACROSS THE FACING, WHICH IS WHAT SEPARATES THE TWO MODELS. Sent
// along the facing, an inherited drift would read as a speed `300` too high and
// nothing else; sent ACROSS it, it reads as a `300`-unit sideways component that
// the rule says must not be there at all, while the along-facing component stays
// exactly `TORPEDO_SPEED` under both models. So the two readings below name which
// model the build implemented: a build that adds the ship's velocity reads `300`
// across, a build that launches along its VELOCITY rather than its facing reads
// `35` degrees off, and a conformant one reads `420` along and nothing across.
//
// THREE HUNDRED UNITS PER SECOND is inside the `SHIP_MAX` (`680`) cap
// specs/ship.md fixes, so it is a speed the ship can really carry, and it is
// seventy per cent of `TORPEDO_SPEED` — far outside any tolerance a launch
// reading can carry.
//
// THE READING IS TAKEN ON THE TICK OF THE LAUNCH, before anything can act on the
// velocity: specs/gravity.md never pulls a torpedo, and one tick of the ship's own
// drag cannot reach a torpedo at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { SHIP_MAX, TORPEDO_SPEED } from "../constants";
import { componentAcross, componentAlong, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  velocityOf,
  type Harness,
} from "../harness";
import { LAUNCH_FACING, poseShip, pressTorpedo, theTorpedo } from "./scene";

/** The drift the ship carries across its facing, in units per second. */
const DRIFT = 300;

/**
 * How far the along-facing component may sit from `TORPEDO_SPEED`, in units per
 * second.
 *
 * Three per cent of `420`, the manifest's own allowance: `12.6`. A build that adds
 * the ship's velocity to its torpedo's is out by `300` on the across component,
 * twenty-four times this.
 */
const TOLERANCE = 0.03 * TORPEDO_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("launches at 420 along the facing from a ship drifting 300 across it", async () => {
  await startPlaying(h);
  // The drift runs across the facing: a quarter turn clockwise from it.
  const facing = unitAt(LAUNCH_FACING);
  const across = { x: -facing.y, y: facing.x };
  await poseShip(h, {
    vx: across.x * DRIFT,
    vy: across.y * DRIFT,
  });

  const launched = await pressTorpedo(h);
  // The torpedo leaving a drifting ship on the facing alone.
  await captureStill(h, "launch");

  const torpedo = theTorpedo(launched, "the launch taken from a drifting ship");
  const velocity = velocityOf(torpedo);

  assertLessThanOrEqual(
    Math.abs(componentAlong(velocity, facing) - TORPEDO_SPEED),
    TOLERANCE,
    `the torpedo's velocity along the ship's facing, in units per second, ` +
      `against the TORPEDO_SPEED (${TORPEDO_SPEED}) specs/weapons.md fixes; ` +
      `it read ${componentAlong(velocity, facing).toFixed(2)}`,
  );
  assertLessThanOrEqual(
    Math.abs(componentAcross(velocity, facing)),
    TOLERANCE,
    `the torpedo's velocity across the ship's facing, in units per second, ` +
      `launched from a ship drifting ${DRIFT} that way — inside the ` +
      `SHIP_MAX (${SHIP_MAX}) cap, so a speed the ship can really carry ` +
      `(specs/weapons.md: a torpedo carries none of the ship's drift, so its ` +
      `velocity at launch is TORPEDO_SPEED along its heading and nothing ` +
      `else); it read ${componentAcross(velocity, facing).toFixed(2)}`,
  );
});
