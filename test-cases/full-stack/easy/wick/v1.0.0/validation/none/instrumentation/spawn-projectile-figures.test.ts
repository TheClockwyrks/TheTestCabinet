// Wick — instrumentation/spawn-projectile-figures: with Ember held at level 8
// and Glass 2 and Wick 1 held, a posed ember reads `radius` 12, `damage` 27.5,
// and `ttl` 2.0; with Ember not held, a posed ember reads level 1's `radius`
// `8 × 1.2` and `damage` `10 × 1.1`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnProjectile(...)`): "`radius` is the weapon's table radius at the level
// held, or at level `1` ... when the weapon is not held, times the `areaMul`
// in force at the call; `damage` is that row's damage times the `damageMul`
// in force at the call; `ttl` is that row's duration". `EMBER_LEVELS` row 8 is
// radius 10, damage 25, duration 2.0; row 1 is radius 8, damage 10.
// specs/passives.md: `areaMul = 1 + 0.1 × glass`, `damageMul = 1 + 0.1 ×
// wick`. The products are read to `FLOAT_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. Two poses under the same passives, one
// with Ember held at its top level and one with it removed, so the row the
// figures come from is decided by the loadout and the multipliers by the
// passives, and a build that read the wrong row or skipped a multiplier
// misses at least one figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  areaMul,
  damageMul,
  FLOAT_TOL,
  MAX_WEAPON_LEVEL,
  weaponRow,
  type PassiveLevels,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  placeProjectile,
  type Harness,
} from "../harness";

const LEVELS: PassiveLevels = { glass: 2, wick: 1 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes its figures from the weapon's row and the multipliers in force", async () => {
  await isolate(h);
  await holdPassive(h, "glass", LEVELS.glass);
  await holdPassive(h, "wick", LEVELS.wick);
  const slot = await holdWeapon(h, "ember", MAX_WEAPON_LEVEL);

  const held = await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const top = weaponRow("ember", MAX_WEAPON_LEVEL);
  assertNear(
    held.radius,
    top.radius! * areaMul(LEVELS),
    FLOAT_TOL,
    "radius with Ember 8 held",
  );
  assertNear(
    held.damage,
    top.damage * damageMul(LEVELS),
    FLOAT_TOL,
    "damage with Ember 8 held",
  );
  assertNear(held.ttl, top.duration!, FLOAT_TOL, "ttl with Ember 8 held");

  await h.debug.removeWeapon(slot);
  const unheld = await placeProjectile(h, "ember", -100, 0, -400, 0, 0);
  await captureStill(h, "figures");
  const first = weaponRow("ember", 1);
  assertNear(
    unheld.radius,
    first.radius! * areaMul(LEVELS),
    FLOAT_TOL,
    "radius with Ember not held",
  );
  assertNear(
    unheld.damage,
    first.damage * damageMul(LEVELS),
    FLOAT_TOL,
    "damage with Ember not held",
  );
  assertNear(unheld.ttl, first.duration!, FLOAT_TOL, "ttl with Ember not held");
});
