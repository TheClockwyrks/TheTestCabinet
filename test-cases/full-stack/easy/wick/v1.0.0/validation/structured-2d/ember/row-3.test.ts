// ember/row-3 — EMBER_LEVELS row 3 is in force at level 3.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember") gives the row
// for level 3: damage 10, cooldown 1.00, speed 400, radius 8, pierce 0,
// duration 2.0, amount 2. The same file fixes what each column becomes on
// the firing tick with no passive held (`specs/passives.md` makes every
// multiplier `1` and `amountBonus` `0` at level 0):
//   - "Damage: table value × `damageMul`" and "Width, Height, Radius, Orbit,
//     Area: table value × `areaMul`" (Derived stats), so `damage` 10 and
//     `radius` 8 on each bolt;
//   - "Speed, Pierce, Duration: table value, unchanged", the bolt "fired from
//     the player's center at `speed`" (Ember) so its velocity's magnitude is
//     400, "Its pierce is the table `pierce`" so 0, and "A projectile's
//     `ttl` is set to its `duration` when it is fired" (Projectiles and
//     pierce) so `ttl` 2 on the tick it is fired, before any count-down;
//   - "With amount `n`, `n` bolts fire on the same tick, one at each of the
//     `n` nearest distinct enemies" (Ember), so 2 bolts with 2 enemies
//     alive;
//   - "After firing, the timer is set to the weapon's current cooldown"
//     (Cooldown timers), "the table cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN` (`0.2`)", so the timer reads 1 after the firing.
//
// WHY `ttl` READS 2 AND NOT ONE TICK LESS. `specs/world.md` ("One tick"),
// phase 6: "Every projectile and zone that existed before this tick counts its
// `ttl` down", and a bolt the tick created did not exist before it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with 2 moths at the
// first 2 posts of `TARGET_POSTS`, each 500 units out in a direction of its own,
// Ember at level 3 with its timer at 0, `weaponFire` on and every other
// switch off, so the count read is the row's amount and no passive scales a
// figure. Which target each bolt takes is `aims-nearest`'s and
// `amount-fires-distinct-nearest`'s point; this check reads the row.
//
// THE TOLERANCE. `REAL_EPS` on damage, radius, ttl, and the timer, each a
// table value times a multiplier of `1` or a value set outright, and
// `MOTION_EPS` on the speed, the magnitude of a unit vector scaled by 400;
// the count and the pierce are whole numbers compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { cooldownOf, EMBER_LEVELS, MOTION_EPS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEmber, TARGET_POSTS } from "./firing";

/** Level 3 of Ember. */
const LEVEL = 3;
const ROW = EMBER_LEVELS[LEVEL - 1];

/** One post per bolt the row fires: 2 enemies alive to aim at. */
const POSTS = TARGET_POSTS.slice(0, ROW.amount);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 2 bolts carrying row 3's figures and sets the timer to 1", async () => {
  assertEqual(ROW.amount, 2, "the amount EMBER_LEVELS row 3 gives");
  const firing = await fireEmber(h, LEVEL, POSTS);
  captureStill(h, "row");

  assertEqual(
    firing.bolts.length,
    ROW.amount,
    "the bolts the firing tick created at amount 2",
  );
  firing.bolts.forEach((bolt, i) => {
    assertEqual(bolt.weapon, "ember", `bolt ${i}: weapon`);
    assertNear(bolt.radius, ROW.radius, REAL_EPS, `bolt ${i}: radius`);
    assertNear(bolt.damage, ROW.damage, REAL_EPS, `bolt ${i}: damage`);
    assertNear(
      Math.hypot(bolt.vx, bolt.vy),
      ROW.speed,
      MOTION_EPS,
      `bolt ${i}: speed, the magnitude of its velocity`,
    );
    assertEqual(bolt.pierce, ROW.pierce, `bolt ${i}: pierce`);
    assertNear(
      bolt.ttl,
      ROW.duration,
      REAL_EPS,
      `bolt ${i}: ttl on the firing tick`,
    );
  });
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    "Ember's timer after the firing, against row 3's cooldown with no Oil held",
  );
});
