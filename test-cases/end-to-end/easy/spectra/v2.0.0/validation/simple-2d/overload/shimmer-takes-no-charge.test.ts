// overload/shimmer-takes-no-charge — a shimmering Flux takes no charge.
//
// specs/mode.md carves one exception out of the charging rule: "A Flux struck while
// it shimmers takes no charge and is not destroyed. It has no band to mismatch."
//
// THE POSE IS THE EDGE CASE, AND NOTHING ELSE. A Flux is posed mid-shimmer — its band
// clock past `fluxHold(stage)`, which specs/drones.md is where the shimmer begins —
// with its oscillation OFF, so the clock stays exactly where the check put it and the
// Flux is still shimmering when the bullet arrives. Its travel and its firing are off
// too: the only thing that can happen to this drone over the scenario is what the shot
// does to it.
//
// WHICH BAND THE SHOT CARRIES, AND WHY IT IS THE ONE THAT CATCHES BOTH WRONG MODELS.
// A shimmering Flux "reads as the band it is moving toward, which is the opposite of
// the one it stores" (specs/drones.md), so a bullet carrying the STORED band is the
// one specs/bands.md would call a mismatch. Sending that one in:
//
//   * a build that ignores the shimmer and charges on a mismatch reads charge 2 and
//     fails;
//   * a build that reads a shimmering Flux as its STORED band takes the shot as a
//     match and destroys the drone, and fails on the other assertion;
//   * a conforming build leaves both readings exactly as they were posed.
//
// THE CHARGE IS POSED AT 1 RATHER THAN 0, so the reading distinguishes a build that
// adds a charge (2), one that clears the charge on the contact (0), and one that
// leaves it alone (1). A zero would have made two of those three the same number.
//
// THE SHOT HAS TO ARRIVE, or the reading is worthless — a drone nothing reached is
// trivially unchanged. So the bullet is read first: consumed on the contact, or
// climbed past the Flux's centre, either of which says the flight really covered the
// gap it was fired across.
//
// WHAT THIS DOES NOT DECIDE. That no shot of the MATCHING band destroys a shimmering
// Flux, which is `drones/flux-shimmer-immune`; how long the shimmer lasts, which is
// `drones/flux-shimmer-duration`.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_SHIMMER, FORM_CENTER_X, fluxHold } from "../../src/constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  findBullet,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeOf, mismatchShot } from "./charge";

/** The stage `startPosed` opens on, which fixes `fluxHold`. */
const STAGE = 1;

/** Where the target Flux stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * Where in its band window the Flux is posed, in seconds.
 *
 * Half a `FLUX_SHIMMER` (0.4) past `fluxHold(STAGE)`, which is the middle of the
 * shimmer: 0.2 s of it stands either side of the pose, and the whole flight below
 * takes under 0.2 s of game time — so a build whose shimmer runs on its own clock
 * despite the gate is still shimmering when the bullet lands.
 */
const POSED_CLOCK = fluxHold(STAGE) + FLUX_SHIMMER / 2;

/** The charge the Flux is posed at: a value neither a charge nor a clear leaves. */
const POSED_CHARGE = 1;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly seven times the 21-unit contact reach a Flux has against one of the
 * player's bullets (`FLUX_HALF` 15 + `PLAYER_BULLET_HALF` 6), so the bullet starts
 * well clear and climbs into the drone.
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a shimmering Flux's charge alone and does not destroy it", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET.x, TARGET.y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
    charge: POSED_CHARGE,
  });

  assertEqual(
    droneOf(h.snapshot(), target).shimmer,
    true,
    `a Flux posed ${String(POSED_CLOCK)} s into its band window, past the ` +
      `${String(fluxHold(STAGE))} s hold stage ${String(STAGE)} gives it, ` +
      "shimmering (specs/drones.md)",
  );

  const shot = await mismatchShot(h, target, SHOT_BELOW);
  captureStill(h, "unchanged");

  const bullet = findBullet(h.snapshot(), shot.bulletId);
  assertTrue(
    bullet === null || bullet.y < TARGET.y,
    `the ${shot.band} shot reached the shimmering Flux: fired ` +
      `${String(SHOT_BELOW)} units below y ${String(TARGET.y)} and flown the ` +
      "frames PLAYER_BULLET_SPEED needs to cover them, it has either resolved on " +
      "contact or climbed past the drone's centre (specs/ship.md)",
  );
  assertNotNull(
    findDrone(h.snapshot(), target),
    "the shimmering Flux still on the field, which no shot destroys " +
      "(specs/mode.md, specs/drones.md)",
  );
  assertEqual(
    chargeOf(
      droneOf(h.snapshot(), target),
      "the shimmering Flux the shot struck",
    ),
    POSED_CHARGE,
    "the charge a Flux struck while it shimmers carries afterwards, which is the " +
      "one it carried before: it has no band to mismatch (specs/mode.md)",
  );
});
