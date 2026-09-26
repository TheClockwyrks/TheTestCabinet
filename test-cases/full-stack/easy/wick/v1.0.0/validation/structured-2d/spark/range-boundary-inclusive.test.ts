// spark/range-boundary-inclusive — an enemy at exactly SPARK_RANGE is in
// range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): strikes land
// "among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center", and ("Shapes and overlap"): "An enemy is within `d` of a point
// when the distance from that point to the enemy's center is at most `d`."
// At most, so a moth whose center is exactly 600 units from the
// lamplighter's center is an eligible target: at level 1 the firing tick
// creates one strike zone centered on it and it takes the damage. A build
// that reads the range as strictly less than 600 lands nothing here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at
// `(600, 0)`, whose distance from the origin is exactly 600 with no
// rounding, Spark at level 1 with its timer at 0, `weaponFire` on and every
// other switch off, so the moth is the only enemy and nothing but the strike
// can touch it. A moth's 5 hp against a damage of 15 means the struck moth
// dies on the landing tick; a build that lowered its hp without removing it
// has landed the hit all the same.
//
// THE TOLERANCE. `REAL_EPS` on the zone's center, a posed position copied
// into the zone; the count and the outcome readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_LEVELS, SPARK_RANGE } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type Point,
} from "../harness";
import { enemyOutcome, fireSpark, postOf } from "./strike";

/** Level 1 of Spark: amount 1. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** The one moth, exactly `SPARK_RANGE` along `+x`. */
const POSTS: readonly Point[] = [{ x: SPARK_RANGE, y: 0 }];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands the strike on the moth exactly 600 units out", async () => {
  assertEqual(ROW.amount, 1, "the amount SPARK_LEVELS row 1 gives");
  assertEqual(
    Math.hypot(POSTS[0].x, POSTS[0].y),
    SPARK_RANGE,
    "the posed moth's distance from the lamplighter's center",
  );
  const firing = await fireSpark(h, LEVEL, POSTS);
  captureStill(h, "boundary");

  assertEqual(
    firing.strikes.length,
    1,
    "the strike zones the firing tick created with the moth at exactly SPARK_RANGE",
  );
  assertEqual(
    postOf(firing.strikes[0], POSTS, firing.before.run.player),
    0,
    `the strike centered on the moth at 600, read at (${firing.strikes[0].x}, ${firing.strikes[0].y})`,
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[0], firing.hpBefore[0]),
    "hit",
    "the moth at exactly SPARK_RANGE on the landing tick",
  );
});
