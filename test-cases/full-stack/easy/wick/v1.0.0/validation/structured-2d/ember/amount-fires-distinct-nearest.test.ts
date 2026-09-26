// ember/amount-fires-distinct-nearest — amount n fires n bolts at the n
// nearest distinct enemies.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "With amount
// `n`, `n` bolts fire on the same tick, one at each of the `n` nearest
// distinct enemies". Level 2's row gives amount 2 and speed 400. And ("The
// nearest enemy"): "The `n` nearest enemies are the first `n` in that same
// ordering, distance then `id`", with "A direction toward an enemy is the
// unit vector from the player's center to the enemy's center". So with moths
// at distances 100, 200, and 300, the firing tick creates two bolts, one
// with velocity 400 along the unit vector to the moth at 100 and one along
// the unit vector to the moth at 200, and none toward the moth at 300.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with three moths at
// `(100, 0)`, `(0, 200)`, and `(-300, 0)`, three distinct directions so a bolt
// names its target by its velocity alone, Ember at level 2 armed, `weaponFire`
// on and every other switch off. The nearest moth is 100 units out, far past
// the 18 units inside which a bolt at the player's center would overlap it, so
// the tick creates its bolts and hits nothing.
//
// THE READING. Each of the two nearer moths must have exactly one bolt aimed
// at it, and those must be two different bolts, which with a count of two
// leaves none for the farthest moth. Which bolt takes which id is the build's.
//
// THE TOLERANCE. `MOTION_EPS` on each velocity component when matching a bolt
// to a target: a stated speed times a unit vector, rounded by ulps, while the
// three directions are 90 degrees apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EMBER_LEVELS, MOTION_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  unit,
  type Harness,
  type Point,
} from "../harness";
import { fireEmber } from "./firing";

/** Level 2 of Ember: amount 2, speed 400. */
const LEVEL = 2;
const ROW = EMBER_LEVELS[LEVEL - 1];

/** Three moths at distances 100, 200, and 300, in three distinct directions. */
const POSTS: readonly Point[] = [
  { x: 100, y: 0 },
  { x: 0, y: 200 },
  { x: -300, y: 0 },
];

/** Whether `bolt` carries speed 400 along the unit vector toward `post`. */
function aimedAt(bolt: { vx: number; vy: number }, post: Point): boolean {
  const toward = unit(post.x, post.y);
  return (
    Math.abs(bolt.vx - ROW.speed * toward.x) <= MOTION_EPS &&
    Math.abs(bolt.vy - ROW.speed * toward.y) <= MOTION_EPS
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires two bolts, one at the moth at 100 and one at the moth at 200", async () => {
  const firing = await fireEmber(h, LEVEL, POSTS);
  captureStill(h, "two");

  assertEqual(
    firing.bolts.length,
    ROW.amount,
    "the bolts the firing tick created at amount 2",
  );
  const nearest = firing.bolts.findIndex((bolt) => aimedAt(bolt, POSTS[0]));
  const second = firing.bolts.findIndex((bolt) => aimedAt(bolt, POSTS[1]));
  assertEqual(
    nearest >= 0,
    true,
    "a bolt aimed at the moth 100 units out (velocity 400 × (1, 0))",
  );
  assertEqual(
    second >= 0,
    true,
    "a bolt aimed at the moth 200 units out (velocity 400 × (0, 1))",
  );
  assertEqual(
    nearest !== second,
    true,
    "the two bolts aimed at two different moths",
  );
});
