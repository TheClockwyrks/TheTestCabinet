// torpedo/launches-from-the-nose — a torpedo leaves from the ship's nose.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The launch: "A torpedo leaves the
// ship's nose, AHEAD of the ship's centre along its facing and NO FURTHER FROM IT
// THAN `SHIP_R` (`14`)". Two requirements in one sentence, and this item reads
// both of them off one launch. Where it goes from there is the flight items'
// business; this one decides where it starts.
//
// THE SHIP IS AT REST AND OFF EVERY AXIS. A ship at rest cannot move between the
// pose and the reading, so the centre the torpedo is measured from is the centre
// it left. The facing is `-35` degrees, which is neither an axis nor the bearing
// from this pose to the star, so a build that spawns its torpedo "above the ship"
// or "toward the middle of the field" rather than along the facing reads as a
// different number rather than passing by coincidence.
//
// WHY TWO CANDIDATE LAUNCH POINTS ARE ALLOWED. `specs/simulation.md` fixes the
// order of work inside a tick but does not say where in it a torpedo is launched,
// so a conforming build may create it before that tick's position step and let it
// fly one tick, or after it and leave it standing at the nose. A check cannot look
// inside a tick — the torpedo only exists once the tick that launched it has run —
// so `launchCandidates` reconstructs BOTH readings and `launchReading` takes the
// nearer. A build that put its torpedo anywhere but the nose is outside the
// specification's bound under both.
//
// NOTHING CAN MOVE THE READING. `specs/gravity.md` exempts the ship from the
// star's pull entirely and exempts the torpedo too — it is a powered craft, and
// "the well never adds anything to their velocity" — so over the single tick
// between the press and the reading neither body is anywhere but where its own
// velocity put it.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_R } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  requireOnlyTorpedo,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";
import { TORPEDO_ACTION, launchReading } from "./scenario";

/** Where the ship is posed, and which way it faces. */
const SHIP_X = 200;
const SHIP_Y = 200;
const FACING = -35 * DEG;

/**
 * How far past `SHIP_R` the torpedo's distance from the centre may read, in
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

it("puts a launched torpedo at the ship's nose, ahead of it along its facing", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, SHIP_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);

  await tapAction(h, TORPEDO_ACTION);
  const torpedo = requireOnlyTorpedo(
    h.snapshot(),
    "one press of the torpedo key on a charged ship launches one " +
      "(torpedo/the-torpedo-action-launches-one)",
  );
  // The torpedo leaving the ship's nose.
  captureStill(h, "launch");

  const launch = launchReading(torpedo, { x: SHIP_X, y: SHIP_Y }, FACING);

  assertGreaterThan(
    launch.ahead,
    0,
    "the torpedo's launch point ahead of the ship's centre along its facing, " +
      "in units along that facing (specs/weapons.md: a torpedo leaves the " +
      `ship's nose, ahead of the centre along its facing); read ${launch.when}`,
  );
  assertLessThanOrEqual(
    launch.reach,
    SHIP_R + REACH_SLACK,
    `the torpedo's launch point no further than SHIP_R (${SHIP_R}) from the ` +
      `ship's centre, in units (specs/weapons.md); read ${launch.when}`,
  );
});
