// spark/distinct-targets — amount n strikes land on n distinct enemies.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center". Level 2's row gives amount 2, so with three moths within range
// the firing tick creates two strike zones, and since each zone is centered
// on its target ("Every zone's position is the center of its shape"), the
// two are centered on two different moths. A build that lands both strikes
// on one moth, or one strike twice, fails here.
//
// WHY THIRTY FIRINGS. The targets are drawn at random, so a build that draws
// its two targets independently, with replacement, lands its two strikes on
// two different moths two firings in three and on the same moth the third.
// One firing would pass such a build by chance two times in three; over
// thirty firings, each of which must land on two different moths, it passes
// by chance about five times in a million, while a conformant build, whose
// draw never repeats a target, passes every firing. Every firing asserts the
// same one requirement.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run posed once by `isolate`,
// Spark at level 2 with `weaponFire` on and every other switch off. Each
// firing stands three fresh moths at the first three of `TARGET_POSTS`, 300
// units out in three directions ninety degrees apart, so a zone names its
// target by its center alone; a moth's 5 hp against a damage of 15 means a
// struck moth dies on the landing tick, so before the next firing every
// enemy, zone, gem, and pickup is cleared through the surface and the three
// are stood up again, and Spark's timer is put back to 0 through
// `setWeaponCooldown` so every firing is the next tick's. Which two of the
// three are struck is the draw's; this check reads only that the two are
// different.
//
// THE TOLERANCE. `REAL_EPS` on each zone's center when matching it to a
// post, a posed position copied into the zone, while the posts are hundreds
// of units apart; the count is a whole number compared exactly.

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

/** Level 2 of Spark: amount 2. */
const LEVEL = 2;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** Three moths within range: one more than the row's amount. */
const POSTS = TARGET_POSTS.slice(0, 3);

/** How many firings the two targets are read on. */
const FIRINGS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands two strikes centered on two different moths on every firing", async () => {
  assertEqual(ROW.amount, 2, "the amount SPARK_LEVELS row 2 gives");
  isolate(h);
  const slot = holdWeapon(h, "spark", LEVEL);
  const origin = h.snapshot().run.player;

  for (let firing = 0; firing < FIRINGS; firing += 1) {
    h.debug.clearEnemies();
    h.debug.clearZones();
    h.debug.clearGems();
    h.debug.clearPickups();
    for (const post of POSTS) placeEnemyNear(h, "moth", post.x, post.y);
    armWeapon(h, slot);
    const before = h.snapshot();
    const after = await advanceTicks(h, 1);
    if (firing === FIRINGS - 1) captureStill(h, "distinct");
    const strikes = zonesCreatedSince(before, after).filter(
      (zone) => zone.kind === "strike",
    );

    assertEqual(
      strikes.length,
      ROW.amount,
      `firing ${firing}: the strike zones the tick created at amount 2 with three moths within range`,
    );
    const posts = strikes.map((zone) => postOf(zone, POSTS, origin));
    posts.forEach((post, i) => {
      assertGreaterThanOrEqual(
        post,
        0,
        `firing ${firing}, strike ${i}: centered on one of the three moths, read at (${strikes[i].x}, ${strikes[i].y})`,
      );
    });
    assertEqual(
      posts[0] !== posts[1],
      true,
      `firing ${firing}: the two strikes centered on two different moths (posts ${posts[0]} and ${posts[1]})`,
    );
  }
});
