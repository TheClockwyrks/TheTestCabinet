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
// tolerance — and one that spawns at the ship's own centre reads 400. Posed at the
// centre of the lane, the first two of those would have passed.
//
// WHAT "ABOVE `SHIP_Y`" IS ASSERTED AS, AND WHAT IS DELIBERATELY NOT. That the
// bullet's centre is above the lane. WHERE along the nose a build puts it — on the
// hull's leading edge at `SHIP_Y - SHIP_H / 2`, or with the bullet's own body clear
// of it — is the build's, and `specs/ship.md` fixes no figure for it, so no bound
// is asserted beyond the one the specification states. Reading a tighter one off
// the reference implementation would grade builds against an implementation rather
// than against the specification.
//
// THE SHIP DOES NOT MOVE WHILE THE SHOT IS TAKEN. No direction is held, so the `x`
// the bullet is compared against is the `x` the ship stood at when it fired: the
// reading is not taken where the environment has moved the quantity. The bullet
// itself climbs one frame's worth during the press (6.3 units at
// `PLAYER_BULLET_SPEED`), which moves it further above `SHIP_Y` and never toward
// it, and moves its `x` not at all.
//
// THE PRESS IS A ONE-FRAME HOLD. `specs/controls.md` reads `a` as a hold, so the
// key goes down, one frame runs, and it is released — `Harness.tap` releases the
// key before the frame runs, which leaves a hold action at rest for the whole of
// it. That one press produces exactly one bullet is
// `ship/fire-spawns-bullet`'s point; here the roster is checked only so the bullet
// being measured is unambiguously the one the press made.
//
// THE FIELD IS EMPTY AND NOTHING BLOCKS THE SHOT. `startPosed` clears the four
// rosters, so the bullet read afterwards can only be this press's, and it leaves
// the cooldown and the lockout at zero.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_W, SHIP_Y } from "../../src/constants";
import {
  assertBetween,
  assertEqual,
  assertLength,
  assertLessThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  lastBullet,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";

/** The key the press is delivered on: the first the build bound to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** The press: the key down for exactly one frame, as the header derives. */
const PRESS_TICKS = 1;

/**
 * Where the ship is parked for the shot.
 *
 * Well inside `[SHIP_X_MIN, SHIP_X_MAX]` so the lane's clamp does not move it, and
 * 240 units off the centre of the lane (640) — sixty times the item's tolerance —
 * so a build that spawns its shots at the centre of the lane or of the stage
 * cannot pass by accident.
 */
const SPAWN_X = 400;

/** The review item's tolerance on the shot's `x`: within 4 units of the ship's centre. */
const SPAWN_X_TOLERANCE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the shot on the ship's centre x, above SHIP_Y", async () => {
  startPosed(h);
  h.debug.setShipX(SPAWN_X);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is pressed in is live");
  assertEqual(before.ship.x, SPAWN_X, "the ship is parked off the lane's centre");
  assertLength(
    playerBullets(before),
    0,
    "the field holds none of the player's bullets before the press",
  );

  await holdFor(h, FIRE_KEY, PRESS_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of the
  // shot the press put on the field.
  captureStill(h, "nose");
  const shot = lastBullet(h.snapshot());

  assertBetween(
    shot.x,
    before.ship.x - SPAWN_X_TOLERANCE,
    before.ship.x + SPAWN_X_TOLERANCE,
    `the shot's centre x against the ship's own (${String(before.ship.x)}) — ` +
      `the hull's edges sit ${String(SHIP_W / 2)} units either side ` +
      "(specs/ship.md)",
  );
  assertLessThan(
    shot.y,
    SHIP_Y,
    "the shot's centre y, which leaves the nose ABOVE the ship's lane, SHIP_Y " +
      `(${String(SHIP_Y)}) (specs/ship.md)`,
  );
});
