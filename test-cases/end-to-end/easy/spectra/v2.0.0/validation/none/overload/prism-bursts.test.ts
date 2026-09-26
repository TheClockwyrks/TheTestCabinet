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
// and `overload/prism-core-no-escort`; that an overload takes no layer off the
// Prism, which specs/mode.md states and `overload/charge-resets`'s sibling points
// cover; and what a DIVING Prism fires, which is `drones/prism-fires-two-bands`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BANDS, FORM_CENTER_X, OVERLOAD_AT } from "../constants";
import {
  captureStill,
  createHarness,
  enemyBullets,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/**
 * Where the target Prism stands.
 *
 * High in the play field on the ship's own lane, clear of `FIELD_TOP` (64) by more
 * than the `PRISM_SIZE` (56) footprint it is drawn at, with the whole field under
 * it for the burst.
 */
const TARGET = { x: FORM_CENTER_X, y: 220 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly six times the 34-unit contact reach a shelled Prism has against one of the
 * player's bullets (`PRISM_HALF` 28 + `PLAYER_BULLET_HALF` 6), so the bullet starts
 * well clear and climbs into the drone.
 */
const SHOT_BELOW = 200;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the 34-unit contact reach 166 units up, inside 22
 * frames, and forty leaves slack for whichever frame a build resolves the contact
 * on.
 */
const SHOT_FRAMES = 40;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("puts exactly one cyan and one magenta enemy bullet on the field", async () => {
  await startPosed(harness);
  const target = await poseDrone(harness, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: true,
    charge: OVERLOAD_AT - 1,
    // Its firing, because the reaction being read IS a volley; see the header.
    fire: true,
  });

  assertLength(
    enemyBullets(await harness.snapshot()),
    0,
    "the enemy bullets on the posed field, which `startPosed` clears, so the " +
      "ones counted afterwards are the burst alone",
  );

  const shot = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "both");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
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
