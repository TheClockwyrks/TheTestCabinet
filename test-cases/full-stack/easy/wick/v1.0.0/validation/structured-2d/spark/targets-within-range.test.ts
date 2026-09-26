// spark/targets-within-range — a strike lands on an enemy within SPARK_RANGE.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center", and "Spark's eligible targets are the enemies within
// `SPARK_RANGE`". ("Shapes and overlap"): "An enemy is within `d` of a point
// when the distance from that point to the enemy's center is at most `d`."
// So with one moth 599 units from the lamplighter's center and one 601, the
// nearer moth is the only eligible target: at level 1, amount 1, the firing
// tick creates one strike zone whose center is that moth's center ("Every
// zone's position is the center of its shape"), the moth takes the strike's
// damage ("A strike deals `damage` to its target"), and the moth at 601 is
// untouched.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with a moth at `(599, 0)`
// and a moth at `(-601, 0)`, on opposite sides of the lamplighter so the far
// moth is 1200 units from the strike's center, far beyond level 1's area of
// 40; Spark at level 1 with its timer at 0, `weaponFire` on and every other
// switch off, so nothing but the strike can touch either moth. A moth has 5
// hp (`specs/enemies.md`) against a damage of 15, so the struck moth dies
// on the landing tick and is gone, and a build that lowered its hp without
// removing it has landed the hit all the same.
//
// THE TOLERANCE. `REAL_EPS` on the zone's center, a posed position copied
// into the zone, and on the far moth's hp against the value it was posed
// with; the count and the presence readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SPARK_LEVELS, SPARK_RANGE } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type Point,
} from "../harness";
import { enemyOutcome, fireSpark, hpOf, postOf } from "./strike";

/** Level 1 of Spark: amount 1. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** One moth a unit inside the range, one a unit outside it, on opposite sides. */
const POSTS: readonly Point[] = [
  { x: SPARK_RANGE - 1, y: 0 },
  { x: -(SPARK_RANGE + 1), y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands the one strike on the moth at 599 and leaves the moth at 601 untouched", async () => {
  assertEqual(ROW.amount, 1, "the amount SPARK_LEVELS row 1 gives");
  const firing = await fireSpark(h, LEVEL, POSTS);
  captureStill(h, "range");

  assertEqual(
    firing.strikes.length,
    1,
    "the strike zones the firing tick created with one moth within range",
  );
  const origin = firing.before.run.player;
  assertEqual(
    postOf(firing.strikes[0], POSTS, origin),
    0,
    `the post the strike is centered on, at (${firing.strikes[0].x}, ${firing.strikes[0].y}); 0 is the moth at 599`,
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[0], firing.hpBefore[0]),
    "hit",
    "the moth at 599 on the landing tick",
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[1], firing.hpBefore[1]),
    "untouched",
    "the moth at 601 on the landing tick",
  );
  assertNear(
    hpOf(firing.after, firing.targets[1]),
    firing.hpBefore[1],
    REAL_EPS,
    "the hp of the moth at 601 after the landing tick",
  );
});
