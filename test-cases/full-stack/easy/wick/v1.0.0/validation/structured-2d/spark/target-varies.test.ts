// spark/target-varies — the target is chosen at random.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center". `specs/instrumentation.md` ("A deterministic core") names "a
// strike's target" among the draws the seeded generator makes. A choice
// uniform over four moths strikes each of them, so over forty firings from
// one seed every one of the four is struck at least once; a build that
// always strikes the nearest, the lowest id, or the first in its list
// strikes one moth forty times and fails here.
//
// WHY FORTY. Under a uniform choice the chance that some one of four moths
// goes unstruck in forty independent draws is at most `4 × (3/4)^40`, about
// four in a hundred thousand, so a conformant build fails this by chance
// about never, while any fixed rule fails it outright. A larger count would
// lower that chance further at the price of a longer scenario; forty is what
// the checklist states.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run seeded once by `isolate`
// and never reset again, so the forty draws are one generator's sequence
// ("from one seed"). Spark at level 1, amount 1, so each firing lands one
// strike and names one target. Each firing stands four fresh moths at the
// four `TARGET_POSTS`, 300 units out ninety degrees apart, so a zone names
// its target by its center alone; a moth's 5 hp against a damage of 15
// means the struck moth dies on the landing tick, so before the next firing
// every enemy, zone, gem, and pickup is cleared through the surface and the
// four are stood up again. Between firings Spark's timer is put back to 0
// through `setWeaponCooldown`, so every firing is the next tick's;
// `weaponFire` on and every other switch off throughout.
//
// THE TOLERANCE. `REAL_EPS` on each zone's center when matching it to a
// post, while the posts are hundreds of units apart; the counts are whole
// numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SPARK_LEVELS } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeEnemyNear,
  zonesCreatedSince,
  type Harness,
} from "../harness";
import { postOf, TARGET_POSTS } from "./strike";

/** Level 1 of Spark: amount 1, one target per firing. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** How many firings the draw is watched over. */
const FIRINGS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes each of four moths at least once over forty firings from one seed", async () => {
  assertEqual(ROW.amount, 1, "the amount SPARK_LEVELS row 1 gives");
  isolate(h);
  const slot = holdWeapon(h, "spark", LEVEL);
  const origin = h.snapshot().run.player;
  const struck = TARGET_POSTS.map(() => 0);

  for (let firing = 0; firing < FIRINGS; firing += 1) {
    h.debug.clearEnemies();
    h.debug.clearZones();
    h.debug.clearGems();
    h.debug.clearPickups();
    for (const post of TARGET_POSTS) placeEnemyNear(h, "moth", post.x, post.y);
    armWeapon(h, slot);
    const before = h.snapshot();
    const after = await advanceTicks(h, 1);
    const strikes = zonesCreatedSince(before, after).filter(
      (zone) => zone.kind === "strike",
    );
    assertEqual(
      strikes.length,
      1,
      `firing ${firing}: the strike zones the tick created at amount 1`,
    );
    const post = postOf(strikes[0], TARGET_POSTS, origin);
    assertGreaterThanOrEqual(
      post,
      0,
      `firing ${firing}: the strike centered on one of the four moths, read at (${strikes[0].x}, ${strikes[0].y})`,
    );
    struck[post] += 1;
  }
  captureStill(h, "random");

  struck.forEach((count, post) => {
    assertGreaterThanOrEqual(
      count,
      1,
      `the strikes on the moth at post ${post} over ${FIRINGS} firings (all four: ${struck.join(", ")})`,
    );
  });
});
