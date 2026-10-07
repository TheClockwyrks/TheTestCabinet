// Wick — passives/wick-damage-mul: Wick multiplies a weapon's damage per hit by
// `1 + 0.1` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`" with
// `WICK_DAMAGE_PER_LEVEL` (`0.1`), and ("Damage") "A weapon's damage per hit is
// its table `damage` times `damageMul`. The result is a real number, and enemy
// health is a real number, so a hit removes exactly that amount." Row 1 of
// `EMBER_LEVELS` (`specs/weapons.md`) carries damage `10`, so with Wick at
// level 3 the bolt carries `10 × 1.3 = 13` and the enemy it hits loses `13`.
//
// THE POSE. An isolated night with Wick 3 held through `setPassive` and one
// hound posed `TARGET` (`200`) units along `+x`: Ember "needs at least one
// enemy to fire", and a hound (`hp` `120`, `specs/enemies.md`) survives a hit
// of `13` so the hit is read off its health rather than off a death. The bolt
// is created at the lamplighter's center, `200` from a target whose radius is
// `18` against a bolt radius of `8`, so it hits nothing on the firing tick.
// `effectMotion` is then turned on and `weaponFire` off, so the one bolt flies
// and nothing else fires: the bolt covers `400 / 60` units a tick and needs
// `(200 − 26) / (400 / 60)` of them, so `FLIGHT` (`40`) ticks is generous
// against its `ttl` of `2.0` seconds. Every other faculty stays held.
//
// TOLERANCE. `FLOAT_TOL` on the bolt's damage and on the health it removed,
// each a table figure times a multiplier of exactly `1.3`. The nearest wrong
// answer, an unscaled `10`, is three whole units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, damageMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  enable,
  fireWeapon,
  holdPassive,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The Wick level held: `damageMul` `1.3`. */
const WICK_LEVEL = 3;

/** The Ember level fired: table damage `10`. */
const LEVEL = 1;

/** How far along `+x` the hound stands: clear of the bolt on the firing tick. */
const TARGET = 200;

/** Ticks of flight, generous against the `200` units the bolt closes at `400`. */
const FLIGHT = 40;

/** `10 × (1 + 0.1 × 3)`. */
const EXPECTED_DAMAGE =
  weaponRow("ember", LEVEL).damage * damageMul({ wick: WICK_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries damage 13 on a level-1 Ember bolt with Wick 3 held, and removes 13 from the hound it hits", async () => {
  await isolate(h);
  await holdPassive(h, "wick", WICK_LEVEL);
  const hound = await placeEnemyNear(h, "hound", TARGET, 0);

  const firing = await fireWeapon(h, "ember", LEVEL);
  const bolts = firing.projectiles.filter((shot) => shot.weapon === "ember");
  assertEqual(bolts.length, 1, "Ember bolts the firing tick created");
  assertNear(
    bolts[0]!.damage,
    EXPECTED_DAMAGE,
    FLOAT_TOL,
    "the bolt's damage per hit with Wick 3 held",
  );

  await disable(h, "weaponFire");
  await enable(h, "effectMotion");
  const struck = await h.step(FLIGHT);
  await captureStill(h, "damage");

  assertNear(
    mustEnemy(struck, hound.id).hp,
    hound.hp - EXPECTED_DAMAGE,
    FLOAT_TOL,
    "the hound's hp after the Wick-scaled bolt hit it",
  );
});
