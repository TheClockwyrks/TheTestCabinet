// Wick — instrumentation/set-next-strike-target-discarded: a posed target
// that is out of range on the firing tick is discarded: the strike lands on
// an eligible enemy and `nextStrikeTarget` reads `null`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`
// ("Drawn outcomes", `setNextStrikeTarget(id)`): "A firing on which it is
// dead or out of range discards it and draws every strike at random."
// `specs/weapons.md` ("Spark"): "Spark's eligible targets are the enemies
// within `SPARK_RANGE`".
//
// THE POSE. An isolated night with two owls at the first two posts; the
// second is posed as the target and then moved through `setEnemyPosition` to
// `SPARK_RANGE + 1` units out, so the pose was valid when made and is out of
// range on the firing tick. Spark at level 1 lands one strike, which can only
// be on the eligible owl.
//
// THE TOLERANCE. `REAL_EPS` on the strike's center against the eligible owl's
// post, a copy, through `postOf`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { SPARK_RANGE } from "../constants";
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
import { postOf, TARGET_POSTS } from "../spark/strike";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("discards a target out of range on the firing tick and strikes an eligible enemy", async () => {
  isolate(h);
  const origin = h.snapshot().run.player;
  const posts = TARGET_POSTS.slice(0, 2);
  const [eligiblePost] = posts;
  const [, posed] = posts.map((post) =>
    placeEnemyNear(h, "owl", post.x, post.y),
  );
  const slot = holdWeapon(h, "spark", 1);
  h.debug.setNextStrikeTarget(posed);
  h.debug.setEnemyPosition(posed, origin.x - (SPARK_RANGE + 1), origin.y);

  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  captureStill(h, "discarded");

  const strikes = zonesCreatedSince(before, after).filter(
    (zone) => zone.kind === "strike",
  );
  assertEqual(strikes.length, 1, "strikes the level-1 firing landed");
  assertEqual(
    postOf(strikes[0], [eligiblePost], origin),
    0,
    "the strike, on the eligible owl",
  );
  assertNull(after.run.nextStrikeTarget, "nextStrikeTarget after the firing");
});
