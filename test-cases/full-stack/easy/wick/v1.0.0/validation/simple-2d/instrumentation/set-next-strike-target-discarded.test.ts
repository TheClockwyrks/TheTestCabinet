// instrumentation/set-next-strike-target-discarded — a posed target that is
// out of range on the firing tick is discarded: the strike lands on an
// eligible enemy and `nextStrikeTarget` reads `null`.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md ("Drawn outcomes",
// `setNextStrikeTarget(id)`): "A firing on which it is dead or out of range
// discards it and draws every strike at random." specs/weapons.md ("Spark"):
// "Spark's eligible targets are the enemies within `SPARK_RANGE`".
//
// THE POSE. An isolated night with two owls at the first two posts; the second
// is posed as the target and then moved through `setEnemyPosition` to
// `SPARK_RANGE + 1` units out, so the pose was valid when made and is out of
// range on the firing tick. Spark at level 1 lands one strike, which can only
// be on the eligible owl.
//
// THE TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the
// eligible owl's, a copy.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { SPARK_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armSpark, strikesIn, targetOf, targetsFor } from "../spark/strike";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("discards a target out of range on the firing tick and strikes an eligible enemy", async () => {
  const volley = armSpark(h, 1, targetsFor(2), "owl");
  const [eligible, posed] = volley.targets;
  h.debug.setNextStrikeTarget(posed.id);
  h.debug.setEnemyPosition(
    posed.id,
    volley.player.x - (SPARK_RANGE + 1),
    volley.player.y,
  );

  const after = await h.tick(1);
  captureStill(h, "discarded");

  const strikes = strikesIn(after);
  assertEqual(strikes.length, 1, "strikes the level-1 firing landed");
  assertEqual(
    targetOf(strikes[0], [eligible], "the strike"),
    0,
    "the strike, on the eligible owl",
  );
  assertNull(after.run.nextStrikeTarget, "nextStrikeTarget after the firing");
});
