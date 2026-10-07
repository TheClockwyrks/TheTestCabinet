// Wick — evolutions/hail-row: `HAIL_STATS` is in force.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Hail"): "Hail is
// Pin's dart: a circle of `radius` fired horizontally in the facing direction
// at `speed`, removed after `duration` seconds, with the row's `pierce`, fired
// whether or not any enemy exists. Amount `n` darts fire on the same tick", and
// "The fixed row is `HAIL_STATS`": damage `15`, cooldown `0.5`, speed `700`,
// radius `7`, pierce `3`, duration `1.5`, amount `6`. ("Passives still apply"):
// damage times `damageMul`, cooldown times `cooldownMul` floored at
// `MIN_COOLDOWN` (`0.2`), radius times `areaMul`, and "Speed, pierce, duration
// ... are used as written"; every multiplier is `1` with no passive held
// (`specs/passives.md`). `specs/weapons.md` ("Projectiles and pierce"): "A
// projectile's `ttl` is set to its `duration` when it is fired". So the firing
// tick creates six projectiles of weapon `hail` reading radius `7`, damage
// `15`, speed `700`, pierce `3`, and ttl `1.5`, and the slot reads `0.5` after
// it.
//
// THE POSE. An isolated night with facing posed right and Hail held at level 1
// fired through the shared `fireWeapon`. No enemy is posed: Hail needs no
// target, and `effectMotion` is off, so each dart stands where the firing put it
// with the velocity it gave it.
//
// TOLERANCE. `FLOAT_TOL` on the radius and the damage, each a fixed figure
// times `1`, and on the speed, the magnitude of a velocity; `TIMER_TOL` on the
// ttl and on the timer the firing set. The dart count and the pierce are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { boltsFired } from "./stage";

/** Hail's fixed row, `HAIL_STATS`. */
const ROW = weaponRow("hail");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates six darts of radius 7 with damage 15, speed 700, pierce 3 and ttl 1.5 and sets the timer to 0.5", async () => {
  await isolate(h);
  await h.debug.setFacing("right");

  const firing = await fireWeapon(h, "hail", 1);
  await captureStill(h, "row");

  const darts = boltsFired(firing, "hail");
  assertEqual(darts.length, ROW.amount, "Hail darts the firing tick created");
  for (const dart of darts) {
    assertNear(
      dart.radius,
      ROW.radius ?? NaN,
      FLOAT_TOL,
      `dart ${dart.id}'s radius`,
    );
    assertNear(dart.damage, ROW.damage, FLOAT_TOL, `dart ${dart.id}'s damage`);
    assertNear(
      Math.hypot(dart.vx, dart.vy),
      ROW.speed ?? NaN,
      FLOAT_TOL,
      `dart ${dart.id}'s speed`,
    );
    assertEqual(dart.pierce, ROW.pierce, `dart ${dart.id}'s pierce`);
    assertNear(
      dart.ttl,
      ROW.duration ?? NaN,
      TIMER_TOL,
      `dart ${dart.id}'s ttl`,
    );
  }
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, "hail", "the weapon in the slot that fired");
  assertNear(
    slot?.cooldown ?? NaN,
    ROW.cooldown ?? NaN,
    TIMER_TOL,
    "Hail's timer after the firing",
  );
});
