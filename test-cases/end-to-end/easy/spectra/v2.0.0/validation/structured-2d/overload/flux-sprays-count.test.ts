// overload/flux-sprays-count — an overloaded Flux sprays its new band.
//
// specs/mode.md gives the Flux's reaction: "it fires `OVERLOAD_FLUX_SPREAD` (`3`)
// enemy bullets at once, all carrying its NEW band". Two figures, read together
// because the specification states them together: how many, and what they carry.
//
// THE FIELD IS EMPTY OF BULLETS WHEN THE SHOT LANDS. `startPosed` clears both
// bullet rosters and shuts the wave's three gates, and the one bullet this scenario
// puts in flight is the player's, which specs/bands.md consumes on the contact. So
// the enemy bullets counted afterwards are the spray and nothing else: no drone but
// this one stands, and only a diver fires (specs/swarm.md).
//
// "ITS NEW BAND" IS WHAT MAKES THE POSE MATTER. The Flux is posed holding cyan, so
// its new band is magenta and the spray must carry magenta — a build that fires the
// band the Flux was holding reads three cyan bullets and fails here while a build
// that fires nothing reads none. The flip itself is `overload/flux-flips`; this
// point reads the bullets, and it reads them against the band the drone now
// REPORTS, so the two points cannot both be passed by a build that flips nothing.
//
// THE FLUX'S FIRING FACULTY IS POSED ON. specs/instrumentation.md gates "the shots
// it takes during a dive" with `setDroneFire`, and this spray is not one — the Flux
// is resting in the formation, where specs/swarm.md has it fire nothing. Posing the
// faculty on is what keeps a build that routes the spray through its ordinary
// firing path from failing a point that is not about the gate. Its travel and its
// oscillation stay off, so the drone holds its place and its window.
//
// WHAT THIS DOES NOT DECIDE. The headings those bullets leave on, which is
// `overload/flux-spray-angle`; and how fast an enemy bullet travels, which is the
// `swarm` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  FLUX_HALF,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  PLAYER_BULLET_HALF,
  fluxHold,
} from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/** The stage `startPosed` poses, which is what fixes `fluxHold`. */
const STAGE = 1;

/**
 * Where the target Flux stands.
 *
 * High in the play field on the ship's own lane, so the fan the reaction fires has
 * the whole field under it and every bullet of it is still in flight when the
 * roster is read.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/** The stored band the Flux is posed holding. */
const POSED_BAND = "cyan" as const;

/**
 * Where in its band window the Flux is posed, in seconds.
 *
 * Half of `fluxHold(STAGE)`: inside the held part, so the drone reads as the band
 * it stores and the shot really is a mismatch rather than the shimmer case
 * `overload/shimmer-takes-no-charge` grades.
 */
const POSED_CLOCK = fluxHold(STAGE) / 2;

/** The centre separation a contact needs: `FLUX_HALF` + `PLAYER_BULLET_HALF`. */
const TOUCHING = FLUX_HALF + PLAYER_BULLET_HALF;

/** How far below the target the shot starts: six times the contact reach. */
const SHOT_BELOW = 6 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 14 frames, and thirty leaves
 * slack for whichever sub-step a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly OVERLOAD_FLUX_SPREAD enemy bullets of the Flux's new band on the field", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET_X, TARGET_Y, {
    band: POSED_BAND,
    bandClock: POSED_CLOCK,
    // Its firing, because the reaction being read IS a volley; see the header.
    fire: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  assertLength(
    enemyBullets(h.snapshot()),
    0,
    "the enemy bullets on the posed field, which `startPosed` clears, so the " +
      "ones counted afterwards are the spray alone",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "spray");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  const flux = requireDrone(
    shot.snapshot,
    target,
    "the Flux the overload leaves standing",
  );
  const sprayed = enemyBullets(shot.snapshot);
  assertLength(
    sprayed,
    OVERLOAD_FLUX_SPREAD,
    "the enemy bullets an overloaded Flux puts on the field at once " +
      "(specs/mode.md)",
  );
  for (const [index, bullet] of sprayed.entries()) {
    assertEqual(
      bullet.band,
      flux.band,
      `bullet ${String(index)} of the spray carrying the Flux's NEW band, ` +
        `${flux.band} (specs/mode.md)`,
    );
  }
});
