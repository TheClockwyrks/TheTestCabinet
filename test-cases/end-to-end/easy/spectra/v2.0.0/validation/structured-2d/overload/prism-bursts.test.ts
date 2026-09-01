// overload/prism-bursts — an overloaded Prism bursts one bullet of each band.
//
// specs/mode.md gives the Prism's reaction: "Its exposed layer bursts, firing
// exactly two enemy bullets at once, one cyan and one magenta." That is the
// Prism's own signature carried into this mode — specs/drones.md already has a
// diving Prism fire "one carrying each band, so it threatens the ship whichever
// band the ship is tuned to" — and the count is exact rather than a minimum.
//
// THE FIELD IS EMPTY OF BULLETS WHEN THE SHOT LANDS. `startPosed` clears both
// bullet rosters, the one bullet this scenario puts in flight is the player's, and
// specs/bands.md consumes it on the contact. Only a diver fires (specs/swarm.md)
// and this Prism rests in the formation, so the enemy bullets counted afterwards
// are the burst and nothing else.
//
// THE PRISM IS POSED WITH ITS SHELL STANDING, which is the state `addDrone` gives
// it and the state a wave's Prism is in. That reaction also adds an escort
// (`overload/prism-spawns-escort`), and the escort is a DRONE: it cannot be
// mistaken for one of the two bullets counted here, and specs/swarm.md has it fire
// nothing while it enters.
//
// ITS FIRING FACULTY IS POSED ON, for the reason `overload/flux-sprays-count`
// gives: specs/instrumentation.md's `setDroneFire` gates the shots a drone takes
// DURING A DIVE, and this burst is not one, so posing the faculty on keeps a build
// that routes the burst through its ordinary firing path from failing a point that
// is not about the gate. Its travel stays off, so the Prism holds its place.
//
// WHAT THIS DOES NOT DECIDE. The escort, which is `overload/prism-spawns-escort`
// and `overload/prism-core-no-escort`; and what a DIVING Prism fires, which is the
// `drones` group's.

import { afterEach, beforeEach, it } from "vitest";
import {
  FIELD_TOP,
  OVERLOAD_AT,
  PLAYER_BULLET_HALF,
  PRISM_HALF,
} from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  startPosed,
  type Band,
  type Harness,
} from "../harness";
import { mismatchShot, poseCharge, requireDrone } from "./charge";

/**
 * The two bands, in the order specs/bands.md names them: "There are exactly two
 * bands, `cyan` and `magenta` ... there is no third value and no neutral state."
 */
const BANDS: readonly Band[] = ["cyan", "magenta"];

/**
 * Where the target Prism stands, in logical units.
 *
 * High in the play field on the ship's own lane, clear of `FIELD_TOP` (`64`) by
 * more than the `PRISM_SIZE` (`56`) footprint it is drawn at, with the whole field
 * under it for the burst.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = FIELD_TOP + 156;

/**
 * The centre separation a contact needs against a SHELLED Prism, in logical units.
 *
 * `PRISM_HALF` (`28`, specs/drones.md) and `PLAYER_BULLET_HALF` (`6`,
 * specs/ship.md), overlapped as circles by specs/simulation.md.
 */
const TOUCHING = PRISM_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot starts, in logical units.
 *
 * Nearly six times the contact reach, so the bullet starts well clear of the drone
 * and the contact the check reads is one the flight produced.
 */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the 34-unit contact reach 166 units up, inside 22
 * frames, and forty leaves slack for whichever sub-step a build resolves the
 * contact on.
 */
const SHOT_FRAMES = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly one cyan and one magenta enemy bullet on the field", async () => {
  startPosed(h);
  const target = poseDrone(h, "prism", TARGET_X, TARGET_Y, {
    band: "cyan",
    shell: true,
    // Its firing, because the reaction being read IS a volley; see the header.
    fire: true,
  });
  poseCharge(h, target, OVERLOAD_AT - 1);

  assertLength(
    enemyBullets(h.snapshot()),
    0,
    "the enemy bullets on the posed field, which `startPosed` clears, so the " +
      "ones counted afterwards are the burst alone",
  );

  const shot = await mismatchShot(h, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  captureStill(h, "both");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot placed ${String(SHOT_BELOW)} units below a Prism ` +
      `whose ${String(TOUCHING)}-unit contact reach it climbs into resolved ` +
      `inside ${String(SHOT_FRAMES)} frames`,
  );
  requireDrone(shot.snapshot, target, "the Prism the overload leaves standing");
  const burst = enemyBullets(shot.snapshot);
  assertLength(
    burst,
    BANDS.length,
    "the enemy bullets an overloaded Prism fires at once (specs/mode.md)",
  );
  for (const band of BANDS) {
    assertLength(
      burst.filter((bullet) => bullet.band === band),
      1,
      `the ${band} bullets of the burst, which fires exactly one of each band ` +
        "(specs/mode.md)",
    );
  }
});
