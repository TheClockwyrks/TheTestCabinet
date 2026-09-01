// overload/shimmer-takes-no-charge — a shimmering Flux takes no charge.
//
// specs/mode.md carves one exception out of the charging rule: "A Flux struck while
// it shimmers takes no charge and is not destroyed. It has no band to mismatch."
//
// THE POSE IS THE EDGE CASE, AND NOTHING ELSE. A Flux is posed mid-shimmer — its
// band clock past `fluxHold(stage)`, which specs/drones.md makes where the shimmer
// begins — with its oscillation OFF, so the clock stays exactly where the check put
// it and the Flux is still shimmering when the bullet arrives. Its travel and its
// firing are off too: the only thing that can happen to this drone over the
// scenario is what the shot does to it.
//
// WHICH BAND THE SHOT CARRIES, AND WHY IT IS THE ONE THAT CATCHES BOTH WRONG
// MODELS. A shimmering Flux "reads as the band it is moving toward, which is the
// opposite of the one it stores" (specs/drones.md), so a bullet carrying the
// STORED band is the one specs/bands.md would call a mismatch. Sending that one in:
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
// WHAT THIS DOES NOT DECIDE. That no shot of the MATCHING band destroys a
// shimmering Flux, and how long the shimmer lasts, which are the `drones` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  FLUX_HALF,
  FLUX_SHIMMER,
  PLAYER_BULLET_HALF,
  fluxHold,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { chargeById, mismatchShot, poseCharge, requireDrone } from "./charge";

/** The stage `startPosed` poses, which is what fixes `fluxHold`. */
const STAGE = 1;

/** Where the target Flux stands. As in `overload/mismatch-charges`. */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/**
 * Where in its band window the Flux is posed, in seconds.
 *
 * Half a `FLUX_SHIMMER` (`0.4`) past `fluxHold(STAGE)`, which is the middle of the
 * shimmer: 0.2 s of it stands either side of the pose, and the whole flight below
 * takes 0.3 s of game time at most — so even a build whose shimmer ran on despite
 * the oscillation gate would still be shimmering when the bullet lands.
 */
const POSED_CLOCK = fluxHold(STAGE) + FLUX_SHIMMER / 2;

/** The charge the Flux is posed at: a value neither a charge nor a clear leaves. */
const POSED_CHARGE = 1;

/**
 * The centre separation a contact needs, in logical units.
 *
 * `FLUX_HALF` (`15`, specs/drones.md) and `PLAYER_BULLET_HALF` (`6`,
 * specs/ship.md), overlapped as circles by specs/simulation.md.
 */
const TOUCHING = FLUX_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: six times the contact reach. */
const SHOT_BELOW = 6 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet reaches the drone inside 14 frames, and thirty leaves slack
 * for whichever sub-step a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a shimmering Flux's charge alone and does not destroy it", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET_X, TARGET_Y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
  });
  poseCharge(h, target, POSED_CHARGE);

  assertEqual(
    requireDrone(h.snapshot(), target, "the posed Flux").shimmer,
    true,
    `a Flux posed ${String(POSED_CLOCK)} s into its band window, past the ` +
      `${String(fluxHold(STAGE))} s hold stage ${String(STAGE)} gives it, ` +
      "shimmering (specs/drones.md)",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "unchanged");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot placed ${String(SHOT_BELOW)} units below the ` +
      `shimmering Flux resolved inside the ${String(SHOT_FRAMES)} frames its ` +
      "climb takes",
  );
  assertEqual(
    chargeById(
      shot.snapshot,
      target,
      "the shimmering Flux, which no shot destroys (specs/mode.md)",
    ),
    POSED_CHARGE,
    "the charge a Flux struck while it shimmers carries afterwards, which is " +
      "the one it carried before: it has no band to mismatch (specs/mode.md)",
  );
});
