// Wick — evolutions/beacon-row: `BEACON_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Beacon"): "Beacon is
// Ember's bolt: a circle of `radius` fired from the player's center at `speed`
// toward the nearest enemy on the tick of firing, flying straight and removed
// after `duration` seconds, with the row's `pierce`. With amount `n`, `n` bolts
// fire on the same tick ... and Beacon needs at least one enemy to fire", and
// "The fixed row is `BEACON_STATS`": damage `20`, cooldown `0.25`, speed `500`,
// radius `10`, pierce `2`, duration `2.0`, amount `1`. ("Passives still
// apply"): damage times `damageMul`, cooldown times `cooldownMul` floored at
// `MIN_COOLDOWN` (`0.2`), radius times `areaMul`, and "Speed, pierce, duration
// ... are used as written"; every multiplier is `1` with no passive held
// (`specs/passives.md`), and `0.25` is above the floor. `specs/weapons.md`
// ("Projectiles and pierce"): "A projectile's `ttl` is set to its `duration`
// when it is fired". So with one moth alive the firing tick creates one
// projectile of weapon `beacon` reading radius `10`, damage `20`, speed `500`,
// pierce `2`, and ttl `2.0`, and the slot reads `0.25` after it.
//
// THE POSE. An isolated night with one moth `TARGET_RING` (`200`) units along
// `+x` — far enough that a bolt created at the lamplighter's center, `10 + 10`
// of radii from a hit, reaches nothing on its own tick and stands in the
// snapshot — and Beacon held at level 1 fired through the shared `fireWeapon`.
// `effectMotion` is off, so the bolt holds the velocity the firing gave it.
//
// TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a fixed figure
// times `1`, and on the speed, the magnitude of a velocity a build computed as
// the speed times a unit vector; `TIMER_TOL` on the ttl and on the timer the
// firing set. The bolt count and the pierce are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { boltsFired } from "./stage";

/** Beacon's fixed row, `BEACON_STATS`. */
const ROW = weaponRow("beacon");

/** How far out the one target stands: clear of a bolt at the lamplighter's center. */
const TARGET_RING = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates one bolt of radius 10 with damage 20, speed 500, pierce 2 and ttl 2.0 and sets the timer to 0.25", async () => {
  await isolate(h);
  await placeEnemyNear(h, "moth", TARGET_RING, 0);

  const firing = await fireWeapon(h, "beacon", 1);
  await captureStill(h, "row");

  const bolts = boltsFired(firing, "beacon");
  assertEqual(bolts.length, ROW.amount, "Beacon bolts the firing tick created");
  for (const bolt of bolts) {
    assertNear(
      bolt.radius,
      ROW.radius ?? NaN,
      FLOAT_TOL,
      `bolt ${bolt.id}'s radius`,
    );
    assertNear(bolt.damage, ROW.damage, FLOAT_TOL, `bolt ${bolt.id}'s damage`);
    assertNear(
      Math.hypot(bolt.vx, bolt.vy),
      ROW.speed ?? NaN,
      FLOAT_TOL,
      `bolt ${bolt.id}'s speed`,
    );
    assertEqual(bolt.pierce, ROW.pierce, `bolt ${bolt.id}'s pierce`);
    assertNear(
      bolt.ttl,
      ROW.duration ?? NaN,
      TIMER_TOL,
      `bolt ${bolt.id}'s ttl`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "beacon", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Beacon's timer after the firing",
  );
});
