// Spectra — ship/bullet-spawn-point: a shot leaves the ship's nose.
//
// THE RULE. `specs/ship.md`: a shot "appears centered on the ship's own center
// `x`, above `SHIP_Y`, at the nose of the hull". The review item fixes the
// reading: a fired bullet appears at the ship's centre `x`, within 4 units, above
// `SHIP_Y`.
//
// THE SHIP IS PARKED OFF THE CENTRE OF ITS LANE, AND THAT IS THE POINT. Every
// wrong model of "where a shot comes from" reads as a different number at
// `SPAWN_X` (400): a build that spawns at the lane's centre reads 640, one that
// spawns at the stage's centre reads 640 as well, one that spawns at the ship's
// left or right edge reads 380 or 420 — `SHIP_W / 2` out, five times the item's
// tolerance — and one that spawns at the ship's own centre reads 400. Posed at
// the centre of the lane, the first two of those would have passed.
//
// WHAT "ABOVE `SHIP_Y`" IS ASSERTED AS, AND WHAT IS DELIBERATELY NOT. That the
// bullet's centre is above the lane. WHERE along the nose a build puts it — on
// the hull's leading edge at `SHIP_Y - SHIP_H / 2`, or with the bullet's own body
// clear of it — is the build's, and `specs/ship.md` fixes no figure for it, so no
// bound is asserted beyond the one the specification states. Reading a tighter
// one off the reference implementation would grade builds against an
// implementation rather than against the specification.
//
// THE SHIP DOES NOT MOVE WHILE THE SHOT IS TAKEN. No direction is held, so the
// `x` the bullet is compared against is the `x` the ship stood at when it fired:
// the reading is not taken where the environment has moved the quantity. The
// bullet itself climbs one frame's worth during `tap` (7.6 units at
// `PLAYER_BULLET_SPEED`), which moves it further above `SHIP_Y` and never toward
// it, and moves its `x` not at all.
//
// THE FIELD IS EMPTY AND NOTHING BLOCKS THE SHOT. `startPosed` clears the four
// rosters, so the bullet read afterwards can only be this press's, and it leaves
// the cooldown and the lockout at zero. That one press produces exactly one
// bullet is `ship/fire-spawns-bullet`'s point; here the roster is checked only so
// the bullet being measured is unambiguously the one the press made.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertLessThan,
  fail,
} from "../assert";
import { BINDINGS, SHIP_W, SHIP_Y } from "../constants";
import {
  captureStill,
  createHarness,
  lastBullet,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** The key the press is delivered on: the first `specs/controls.md` binds to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/**
 * Where the ship is parked for the shot.
 *
 * Well inside `[SHIP_X_MIN, SHIP_X_MAX]` so the lane's clamp does not move it,
 * and 240 units off `FORM_CENTER_X` (640) — sixty times the item's tolerance — so
 * a build that spawns its shots at the centre of the lane or of the stage cannot
 * pass by accident.
 */
const SPAWN_X = 400;

/** The review item's tolerance on the shot's `x`: within 4 units of the ship's centre. */
const SPAWN_X_TOLERANCE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the shot on the ship's centre x, above SHIP_Y", async () => {
  await startPosed(h);
  await h.debug.setShipX(SPAWN_X);
  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(
    before.ship.x,
    SPAWN_X,
    "the ship is parked off the lane's centre",
  );
  assertLength(
    playerBullets(before),
    0,
    "the field holds none of the player's bullets before the press",
  );

  await h.tap(FIRE_KEY);
  await captureStill(h, "nose");
  const shot = lastBullet(await h.snapshot());
  if (shot === undefined) {
    fail(
      "the fire action to put a bullet on the field to read (specs/ship.md)",
      "the bullet roster was still empty after the press",
    );
  }

  assertBetween(
    shot.x,
    before.ship.x - SPAWN_X_TOLERANCE,
    before.ship.x + SPAWN_X_TOLERANCE,
    `the shot's centre x against the ship's own (${before.ship.x}) — the hull's edges sit ${SHIP_W / 2} units either side (specs/ship.md)`,
  );
  assertLessThan(
    shot.y,
    SHIP_Y,
    `the shot's centre y, which leaves the nose ABOVE the ship's lane, SHIP_Y (${SHIP_Y}) (specs/ship.md)`,
  );
});
