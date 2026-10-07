// spark/row-5 — SPARK_LEVELS row 5 is in force at level 5.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark") gives the row
// for level 5: damage 25, cooldown 1.8, area 50, amount 3. The same file
// fixes what each column becomes on the firing tick with no passive held
// (`specs/passives.md` makes every multiplier `1` and `amountBonus` `0` at
// level 0):
//   - "Damage: table value × `damageMul`" and "Width, Height, Radius, Orbit,
//     Area: table value × `areaMul`" (Derived stats), with "a strike's
//     `radius` is its `area`" (Shapes and overlap), so `damage` 25 and
//     `radius` 50 on each strike zone;
//   - "On firing, `amount` strikes land, each on a distinct enemy chosen
//     uniformly at random among the live enemies within `SPARK_RANGE`"
//     (Spark), so 3 strikes with 3 enemies within range, each centered on a
//     different enemy ("Every zone's position is the center of its shape");
//   - "A strike deals `damage` to its target" (Spark) and "A hit removes
//     the shape's damage per hit from the enemy's `hp`" (Hits and death),
//     so each target's `hp` falls by exactly 25 on the landing tick;
//   - "After firing, the timer is set to the weapon's current cooldown"
//     (Cooldown timers), "the table cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN` (`0.2`)", so the timer reads 1.8 after the firing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with 3 hounds at the
// first 3 posts of `TARGET_POSTS`, 300 units out, each in a direction of its own,
// Spark at level 5 with its timer at 0, `weaponFire` on and every other
// switch off, so the count read is the row's amount and no passive scales a
// figure. Hounds (120 hp, `specs/enemies.md`) rather than moths, so every
// target outlives the strike and its `hp` reads the damage removed; the
// posts are farther apart than any row's area, so no strike splashes onto
// another target. Which target a strike takes is `distinct-targets`' and
// `target-varies`' point; this check reads the row.
//
// THE TOLERANCE. `REAL_EPS` on damage, radius, each target's hp, each
// zone's center, and the timer, each a table value times a multiplier of
// `1`, a value set outright, or the difference of two such values; the
// count is a whole number compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertNear } from "../assert";
import { cooldownOf, REAL_EPS, SPARK_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireSpark, hpOf, postOf, TARGET_POSTS } from "./strike";

/** Level 5 of Spark. */
const LEVEL = 5;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** One post per strike the row lands: 3 within range to strike. */
const POSTS = TARGET_POSTS.slice(0, ROW.amount);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands 3 strikes carrying row 5's figures and sets the timer to 1.8", async () => {
  assertEqual(ROW.amount, 3, "the amount SPARK_LEVELS row 5 gives");
  const firing = await fireSpark(h, LEVEL, POSTS, "hound");
  captureStill(h, "row");

  assertEqual(
    firing.strikes.length,
    ROW.amount,
    "the strike zones the firing tick created at amount 3",
  );
  const origin = firing.before.run.player;
  const struck = new Set<number>();
  firing.strikes.forEach((zone, i) => {
    assertEqual(zone.weapon, "spark", `strike ${i}: weapon`);
    assertNear(
      zone.radius,
      ROW.area,
      REAL_EPS,
      `strike ${i}: radius, the row's area`,
    );
    assertNear(zone.damage, ROW.damage, REAL_EPS, `strike ${i}: damage`);
    const post = postOf(zone, POSTS, origin);
    assertGreaterThanOrEqual(
      post,
      0,
      `strike ${i}: centered on one of the posed hounds, at (${zone.x}, ${zone.y})`,
    );
    assertEqual(
      struck.has(post),
      false,
      `strike ${i}: on a hound no other strike of this tick landed on`,
    );
    struck.add(post);
    assertNear(
      hpOf(firing.after, firing.targets[post]),
      firing.hpBefore[post] - ROW.damage,
      REAL_EPS,
      `strike ${i}: its target's hp after the landing tick, the posed hp less ${ROW.damage}`,
    );
  });
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    cooldownOf(ROW.cooldown, 0),
    REAL_EPS,
    "Spark's timer after the firing, against row 5's cooldown with no Oil held",
  );
});
