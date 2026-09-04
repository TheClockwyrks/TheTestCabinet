// drones/flux-shimmer-immune — nothing destroys a Flux mid-shimmer.
//
// specs/drones.md, What that means in play: "No shot destroys a shimmering Flux,
// of either band." It is the one hole in the match-to-destroy rule specs/bands.md
// otherwise makes absolute, and it is what makes the telegraph worth watching: a
// player who fires into the shimmer wastes the shot whichever band the cannon is
// tuned to.
//
// EITHER BAND IS ONE REQUIREMENT, SO IT IS ONE CHECK. The rule is not "a matching
// shot spares it" plus "a mismatched shot spares it" — mid-shimmer the drone is
// "settled on neither band", so there is no matching shot to distinguish. Both
// shots are fired into the same posed shimmer, one after the other, and the drone
// is read after each.
//
// HOW THE SHIMMER IS HELD OPEN. The Flux is posed half a telegraph into its
// shimmer with its OSCILLATION GATE OFF, which specs/instrumentation.md defines as
// holding "whichever band or shimmer it is in indefinitely". That is the isolation
// this requirement needs: both shots are decided against a drone that is
// unambiguously shimmering for the whole of both flights, rather than racing a
// `0.4`-second window. Travel and fire stay off, so nothing but the shots happens
// on this field.
//
// The killable half of the window is `drones/flux-held-killable`, which fires the
// same stored band into the same drone with its clock posed inside the hold, so a
// build that spares everything and a build that destroys everything grade
// differently rather than cancelling out.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_SHIMMER, FORM_CENTER_X, fluxHold } from "../constants";
import { assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: where the shimmer starts is per stage. */
const STAGE = 1;

/** The band the shimmering Flux stores, so neither shot is the trivial case. */
const STORED_BAND = "magenta" as const;

/** The other band, fired second, so both of the two are tried. */
const OTHER_BAND = "cyan" as const;

/**
 * The band clock the Flux is posed at: half a telegraph into the shimmer.
 *
 * `fluxHold(1)` is where the shimmer starts and `fluxHold(1) + FLUX_SHIMMER` is
 * where the window ends, so the midpoint is inside the shimmer under any reading of
 * either boundary. Whether the boundary itself shimmers is `instrumentation`'s to
 * grade, not this point's.
 */
const MID_SHIMMER = fluxHold(STAGE) + FLUX_SHIMMER / 2;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Flux each shot is placed, in logical units.
 *
 * Geometry, not a tolerance. A Flux's contact reach against one of the player's
 * bullets is `FLUX_HALF` (`15`) plus `PLAYER_BULLET_HALF` (`6`) = `21` units of
 * centre separation, so `140` starts each bullet nearly seven times clear of it:
 * the contact the check reads is one the flight produced, not one the placement
 * did. `fireAt` derives the flight from `PLAYER_BULLET_SPEED`, so the bullet's
 * centre reaches the drone's and every frame of the approach is run.
 */
const SHOT_BELOW = 140;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a shimmering Flux standing after a shot of either band", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const flux = poseDrone(h, "flux", AT.x, AT.y, {
    band: STORED_BAND,
    bandClock: MID_SHIMMER,
    // Off: the shimmer stands still for both flights, so neither shot is decided
    // against a drone that has settled part-way through it.
    oscillation: false,
  });

  await fireAt(h, AT.x, AT.y, STORED_BAND, SHOT_BELOW);
  assertNotNull(
    findDrone(h.snapshot(), flux),
    `the shimmering Flux a ${STORED_BAND} shot must not destroy (specs/drones.md)`,
  );

  await fireAt(h, AT.x, AT.y, OTHER_BAND, SHOT_BELOW);
  captureStill(h, "immune");

  assertNotNull(
    findDrone(h.snapshot(), flux),
    `the shimmering Flux a ${OTHER_BAND} shot must not destroy either ` +
      "(specs/drones.md)",
  );
});
