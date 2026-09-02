// drones/flux-held-killable — a Flux falls to a matching shot inside its hold.
//
// specs/drones.md, What that means in play: "A shot whose effective band matches
// the Flux during a held part of the window destroys it." This is the half of the
// rhythm that makes the kind beatable at all: the shimmer is the window in which
// nothing works (`drones/flux-shimmer-immune`), and the hold is the window in which
// the matching shot does. A build that spared a Flux in both windows would pass the
// immunity point and fail here, which is the pair working as intended.
//
// HOW THE HOLD IS HELD OPEN. The Flux is posed half-way through the held part of
// its window with its OSCILLATION GATE OFF, which specs/instrumentation.md defines
// as holding "whichever band or shimmer it is in indefinitely". The shot is
// therefore decided against a drone that is unambiguously holding its band for the
// whole flight, rather than one whose clock might reach the shimmer while the
// bullet is still climbing. Travel and fire stay off: this drone is a target and
// nothing else.
//
// MAGENTA IS THE DISTINGUISHING VALUE. `addDrone` creates a drone holding cyan
// (specs/instrumentation.md), so a build that matches against a default rather than
// against the drone's stored band spares the Flux and fails.
//
// THE FRAME THAT KILLS ALSO CLEARS THE STAGE, AND THAT COSTS NOTHING. The world
// holds exactly the drone the requirement concerns, so the kill's own frame is
// necessarily the frame the live wave holds none — which specs/stages.md makes a
// clear. Nothing here reads the screen or the stage; the reading is whether the
// roster still holds the drone, and the clear can only follow the destruction it
// is asserting. So no bystander is parked on the field to hold the wave open.

import { afterEach, beforeEach, it } from "vitest";
import {
  FORM_CENTER_X,
  PLAYER_BULLET_SPEED,
  fluxHold,
} from "../constants";
import { assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: the held part's length is per stage. */
const STAGE = 1;

/** The band the Flux holds, and the band the shot carries. */
const POSED_BAND = "magenta" as const;

/**
 * The band clock the Flux is posed at: half-way through the held part.
 *
 * The hold runs from `0` up to `fluxHold(1)` (specs/drones.md), so its midpoint is
 * inside it under any reading of either end, and it is far enough from the shimmer
 * that the whole flight below lands inside the hold on a build whose clock is
 * frozen and on one whose gate leaks.
 */
const MID_HOLD = fluxHold(STAGE) / 2;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Flux the shot is placed, in logical units.
 *
 * Geometry, not a tolerance. A Flux's contact reach against one of the player's
 * bullets is `FLUX_HALF` (`15`) plus `PLAYER_BULLET_HALF` (`6`) = `21` units of
 * centre separation, so `140` starts the bullet nearly seven times clear of it.
 */
const SHOT_BELOW = 140;

/**
 * Frames the shot is flown for.
 *
 * The climb of `SHOT_BELOW` at `PLAYER_BULLET_SPEED` (`760`, specs/ship.md), which
 * carries the bullet's centre onto the drone's and runs every frame of the approach
 * through the build's own collision code.
 */
const FLIGHT_TICKS = ticksFor(SHOT_BELOW / PLAYER_BULLET_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a Flux hit by its own band during a held window", async () => {
  // An empty, quiet, live wave at stage 1, then exactly the one drone the
  // requirement is about.
  startPosed(h);
  const flux = poseDrone(h, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: MID_HOLD,
    // Off: the hold stands still for the whole flight, so the shot is decided
    // against a Flux that is holding rather than one that reached its shimmer.
    oscillation: false,
  });

  await fireAt(h, AT.x, AT.y, POSED_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "killed");

  assertUndefined(
    droneById(h.snapshot(), flux),
    `the holding Flux a ${POSED_BAND} shot destroys (specs/drones.md)`,
  );
});
