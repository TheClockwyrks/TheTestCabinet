// spark/target-varies — the target is chosen at random.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center". A choice uniform over four moths varies, so over sixteen firings
// the strike lands on at least two distinct posts; a build that always
// strikes the nearest, the lowest id, or the first in its list strikes one
// post sixteen times and fails here.
//
// WHY SIXTEEN. Under a uniform choice the chance that all sixteen independent
// draws land on one of four posts is `4 × (1/4)^16`, under `1e-9`, which is
// the tolerance this check accepts: a conformant build fails this by chance
// about never, while any fixed rule fails it outright. Sixteen is what the
// checklist states.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run posed once by `isolate`
// and never reset again. Nothing is posed for the target, so every draw is
// the build's own; a posed target is `instrumentation/set-next-strike-target`'s.
// Spark at level 1, amount 1, so each firing lands one
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
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
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
const FIRINGS = 16;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes at least two distinct posts over sixteen firings", async () => {
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

  assertGreaterThan(
    struck.filter((count) => count > 0).length,
    1,
    `distinct posts struck over ${FIRINGS} firings (strikes per post: ${struck.join(", ")})`,
  );
});
