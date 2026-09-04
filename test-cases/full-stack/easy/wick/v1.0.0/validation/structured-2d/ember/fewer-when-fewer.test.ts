// ember/fewer-when-fewer — fewer bolts fire when fewer enemies exist.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "With amount
// `n`, `n` bolts fire on the same tick, one at each of the `n` nearest
// distinct enemies, fewer when fewer enemies exist." Level 6's row gives
// amount 3, so with one moth alive the firing tick creates exactly one bolt:
// a build that fires three at the same moth, or three with two aimed at
// nothing, fails here.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at the first
// post, 500 units out, Ember at level 6 armed, `weaponFire` on and every
// other switch off. The count read is the count the tick created, told from
// anything posed before by id.
//
// THE TOLERANCE. None: a count of projectiles is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EMBER_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEmber, TARGET_POSTS } from "./firing";

/** Level 6 of Ember: amount 3. */
const LEVEL = 6;
const ROW = EMBER_LEVELS[LEVEL - 1];

/** The one moth: the first post. */
const POSTS = [TARGET_POSTS[0]];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly one bolt at amount 3 with one moth alive", async () => {
  assertEqual(ROW.amount, 3, "the amount EMBER_LEVELS row 6 gives");
  const firing = await fireEmber(h, LEVEL, POSTS);
  captureStill(h, "fewer");

  assertEqual(
    firing.bolts.length,
    POSTS.length,
    "the bolts the firing tick created at amount 3 with one enemy alive",
  );
});
