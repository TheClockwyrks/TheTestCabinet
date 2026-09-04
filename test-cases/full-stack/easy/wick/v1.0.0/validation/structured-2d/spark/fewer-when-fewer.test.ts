// spark/fewer-when-fewer — fewer strikes land when fewer enemies are in
// range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center, fewer when fewer such enemies exist." Level 5's row gives amount
// 3, so with one moth within range the firing tick creates exactly one
// strike zone: a build that lands three on the same moth, or three with two
// centered on nothing, fails here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at the
// first post of `TARGET_POSTS`, 300 units out, Spark at level 5 with its
// timer at 0, `weaponFire` on and every other switch off. The count read is
// the count the tick created, told from anything posed before by id.
//
// THE TOLERANCE. None: a count of zones is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireSpark, TARGET_POSTS } from "./strike";

/** Level 5 of Spark: amount 3. */
const LEVEL = 5;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** The one moth: the first post. */
const POSTS = [TARGET_POSTS[0]];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly one strike zone at amount 3 with one moth within range", async () => {
  assertEqual(ROW.amount, 3, "the amount SPARK_LEVELS row 5 gives");
  const firing = await fireSpark(h, LEVEL, POSTS);
  captureStill(h, "fewer");

  assertEqual(
    firing.strikes.length,
    POSTS.length,
    "the strike zones the firing tick created at amount 3 with one moth within range",
  );
});
