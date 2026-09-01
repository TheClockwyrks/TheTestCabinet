// passives/wick-damage-mul — Wick multiplies weapon damage by
// `1 + WICK_DAMAGE_PER_LEVEL` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `WICK_DAMAGE_PER_LEVEL` is `0.1`, and
// "damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick", so Wick 3 is `1.3`. The
// Damage section applies it: "A weapon's damage per hit is its table `damage`
// times `damageMul`. The result is a real number, and enemy health is a real
// number, so a hit removes exactly that amount." Ember's level-1 row gives
// `damage` `10` (`specs/weapons.md`, Ember), so the bolt reads `13` and the
// enemy it hits loses `13`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Wick 3 and Ember
// at level 1, with one hound at `RANGE_POST`, the target Ember "needs at least
// one enemy to fire" at. A hound carries `120` hp (`specs/enemies.md`) and the
// run clock is `0`, so nothing scales it and one hit of `13` leaves it alive
// to be read. After the firing tick `weaponFire` goes off, so no second bolt
// is created, and `effectMotion` comes on, so the one bolt flies: "a
// projectile's position advances by its velocity times `TICK_DT`"
// (`specs/world.md`, phase 6).
//
// WHEN THE HIT LANDS. The bolt is created at the lamplighter's center on the
// firing tick and "first moving on the next tick", travelling
// `400 / 60` units a tick. A bolt of radius `8` and a hound of radius `18`
// overlap once their centers are inside `26` (`specs/weapons.md`, Shapes and
// overlap), which is `500 − 26 = 474` units of flight, so `72` moving ticks;
// its `ttl` of `2.0` seconds is `120` ticks, so it is still alive. `pierce` is
// `0`, so the bolt is removed by that one hit and the hound is hit once.
//
// THE TOLERANCE. `REAL_EPS` on the damage, one table figure times one
// multiplier, and on the hound's hp, one subtraction from a whole number; the
// unscaled figure, `10`, is three units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, ENEMIES, REAL_EPS, damageMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  disable,
  enable,
  enemyById,
  type Harness,
} from "../harness";
import { fireUnder, RANGE_POST } from "./firing";

/** The Wick level held: `damageMul` `1.3`. */
const WICK = 3;

/** Ember's level-1 row, whose `damage` is `10`. */
const ROW = EMBER_LEVELS[0];

/** The damage the row's `10` becomes under Wick 3. */
const DAMAGE = ROW.damage * damageMul(WICK);

/** Ticks of flight after the firing tick, past the `72` the hit needs. */
const FLIGHT = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("gives a level-1 Ember bolt damage 13 under Wick 3 and removes 13 from the hound it hits", async () => {
  const firing = await fireUnder(h, {
    passives: [["wick", WICK]],
    weapons: [["ember", 1]],
    enemies: [["hound", RANGE_POST]],
  });
  captureStill(h, "damage");

  assertEqual(
    firing.projectiles.length,
    1,
    "the bolts the firing tick created (specs/weapons.md, Ember)",
  );
  assertNear(
    firing.projectiles[0].damage,
    DAMAGE,
    REAL_EPS,
    "the bolt's damage under Wick 3 (specs/passives.md, Damage)",
  );

  disable(h, "weaponFire");
  enable(h, "effectMotion");
  const hit = await advanceTicks(h, FLIGHT);
  assertNear(
    enemyById(hit, firing.targets[0])?.hp ?? NaN,
    ENEMIES.hound.hp - DAMAGE,
    REAL_EPS,
    "the hound's hp after the bolt hit it (specs/passives.md, Damage)",
  );
});
