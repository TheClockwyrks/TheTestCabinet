// spark/splash — a strike hits every enemy within area of its target.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "A strike
// deals `damage` to its target and to every other enemy within `area` of the
// target's center, on the tick it lands." Level 1's row gives area 40. And
// ("Shapes and overlap"): "An enemy is within `d` of a point when the
// distance from that point to the enemy's center is at most `d`", the
// distance-to-center test a weapon's section may name in place of overlap.
// So a moth whose center is 35 units from the struck target's center takes
// the strike's damage and a moth 45 units away does not. The circle-overlap
// reading (a radius-40 zone against a radius-10 moth overlaps inside 50)
// would hit both, so this check tells the two readings apart.
//
// WHY THE WORLD IS POSED AS IT IS. The target is chosen at random among the
// enemies within `SPARK_RANGE` (600), so the target is made certain by
// posing exactly one eligible enemy: the target moth at `(590, 0)`, inside
// the range, and the two bystanders past it along the same line at
// `(625, 0)` and `(635, 0)`, 625 and 635 units from the lamplighter's center
// and so outside the range, while 35 and 45 units from the target's center.
// The splash is stated over "every other enemy within `area` of the target's
// center" with no range condition, so a bystander outside `SPARK_RANGE` is
// hit like any other. Spark at level 1 with its timer at 0, `weaponFire` on
// and every other switch off, so nothing but the strike can touch a moth. A
// moth's 5 hp against a damage of 15 means a hit moth dies on the landing
// tick; a build that lowered its hp without removing it has landed the hit
// all the same.
//
// THE TOLERANCE. `REAL_EPS` on the zone's center, a posed position copied
// into the zone, and on the far bystander's hp against the value it was
// posed with; the count and the outcome readings are exact.

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

/** Level 1 of Spark: area 40, amount 1. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** Where the one eligible target stands: 10 units inside the range. */
const TARGET_X = SPARK_RANGE - 10;

/** The bystanders' distances from the target's center: inside and outside its area. */
const NEAR_DISTANCE = ROW.area - 5;
const FAR_DISTANCE = ROW.area + 5;

/** The target, then the near bystander, then the far one, all along `+x`. */
const POSTS: readonly Point[] = [
  { x: TARGET_X, y: 0 },
  { x: TARGET_X + NEAR_DISTANCE, y: 0 },
  { x: TARGET_X + FAR_DISTANCE, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the moth 35 units from the target and not the moth 45 units away", async () => {
  assertEqual(ROW.amount, 1, "the amount SPARK_LEVELS row 1 gives");
  assertEqual(ROW.area, 40, "the area SPARK_LEVELS row 1 gives");
  for (const post of POSTS.slice(1)) {
    if (!(Math.hypot(post.x, post.y) > SPARK_RANGE)) {
      throw new Error("a bystander must stand outside SPARK_RANGE");
    }
  }
  const firing = await fireSpark(h, LEVEL, POSTS);
  captureStill(h, "splash");

  assertEqual(
    firing.strikes.length,
    1,
    "the strike zones the firing tick created with one moth within range",
  );
  assertEqual(
    postOf(firing.strikes[0], POSTS, firing.before.run.player),
    0,
    `the strike centered on the one eligible moth, read at (${firing.strikes[0].x}, ${firing.strikes[0].y})`,
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[0], firing.hpBefore[0]),
    "hit",
    "the target on the landing tick",
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[1], firing.hpBefore[1]),
    "hit",
    `the moth ${NEAR_DISTANCE} units from the target's center on the landing tick`,
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[2], firing.hpBefore[2]),
    "untouched",
    `the moth ${FAR_DISTANCE} units from the target's center on the landing tick`,
  );
  assertNear(
    hpOf(firing.after, firing.targets[2]),
    firing.hpBefore[2],
    REAL_EPS,
    `the hp of the moth ${FAR_DISTANCE} units from the target's center after the landing tick`,
  );
});
