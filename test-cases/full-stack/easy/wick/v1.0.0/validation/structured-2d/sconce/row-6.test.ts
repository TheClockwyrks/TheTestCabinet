// sconce/row-6 — SCONCE_LEVELS row 6 is in force at level 6.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce") gives the row
// for level 6: damage 20, cooldown 1.6, speed 600, radius 14,
// duration 2.5, amount 3. The same file fixes what each column becomes on
// the firing tick with no passive held (`specs/passives.md` makes every
// multiplier `1` and `amountBonus` `0` at level 0):
//   - "Damage: table value × `damageMul`" and "Width, Height, Radius, Orbit,
//     Area: table value × `areaMul`" (Derived stats), so `damage` 20 and
//     `radius` 14 on each sconce;
//   - "Speed, Pierce, Duration: table value, unchanged", the sconce "launched
//     from the player's center at `speed`" (Sconce) so its velocity's
//     magnitude is 600, "Its pierce is `INFINITE_PIERCE`" so `-1`, and "A
//     projectile's `ttl` is set to its `duration` when it is fired"
//     (Projectiles and pierce) so `ttl` 2.5 on the tick it is fired, before
//     any count-down;
//   - "Amount `n` launches `n` sconces on the same tick" (Sconce), so three
//     sconces;
//   - "After firing, the timer is set to the weapon's current cooldown"
//     (Cooldown timers), "the table cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN` (`0.2`)", so the timer reads 1.6 after the launch.
//
// WHY `ttl` READS 2.5 AND NOT ONE TICK LESS. `specs/world.md` ("One tick"),
// phase 6: "Every projectile and zone that existed before this tick counts its
// `ttl` down", and a sconce the tick created did not exist before it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with 3 enemies at the
// first 3 posts of `TARGET_POSTS`, each a distance of its own from the
// lamplighter, Sconce at level 6 with its timer at 0, `weaponFire` on and
// every other switch off, so the count read is the row's amount and no passive
// scales a figure. Sconce "needs at least one enemy to fire" (Sconce), so at
// least one stands whatever the row. Which direction each sconce takes is
// `launch-direction`'s and `spread`'s point; this check reads the row.
//
// THE TOLERANCE. `REAL_EPS` on damage, radius, ttl, and the timer, each a
// table value times a multiplier of `1` or a value set outright, and
// `MOTION_EPS` on the speed, the magnitude of a unit vector scaled by 600;
// the count and the pierce are whole numbers compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  cooldownOf,
  INFINITE_PIERCE,
  MOTION_EPS,
  REAL_EPS,
  SCONCE_LEVELS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireSconce, TARGET_POSTS } from "./firing";

/** Level 6 of Sconce. */
const LEVEL = 6;
const ROW = SCONCE_LEVELS[LEVEL - 1];

/** One post per sconce the row launches: 3 enemies alive to aim at. */
const POSTS = TARGET_POSTS.slice(0, ROW.amount);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("launches three sconces carrying row 6's figures and sets the timer to 1.6", async () => {
  assertEqual(ROW.amount, 3, "the amount SCONCE_LEVELS row 6 gives");
  const firing = await fireSconce(h, LEVEL, POSTS);
  captureStill(h, "row");

  assertEqual(
    firing.sconces.length,
    ROW.amount,
    "the sconces the firing tick launched at amount 3",
  );
  firing.sconces.forEach((sconce, i) => {
    assertEqual(sconce.weapon, "sconce", `sconce ${i}: weapon`);
    assertNear(sconce.radius, ROW.radius, REAL_EPS, `sconce ${i}: radius`);
    assertNear(sconce.damage, ROW.damage, REAL_EPS, `sconce ${i}: damage`);
    assertNear(
      Math.hypot(sconce.vx, sconce.vy),
      ROW.speed,
      MOTION_EPS,
      `sconce ${i}: speed, the magnitude of its velocity`,
    );
    assertEqual(sconce.pierce, INFINITE_PIERCE, `sconce ${i}: pierce`);
    assertNear(
      sconce.ttl,
      ROW.duration,
      REAL_EPS,
      `sconce ${i}: ttl on the firing tick`,
    );
  });
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    "Sconce's timer after the launch, against row 6's cooldown with no Oil held",
  );
});
