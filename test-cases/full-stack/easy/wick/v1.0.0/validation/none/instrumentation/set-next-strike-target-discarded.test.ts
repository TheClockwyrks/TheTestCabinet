// Wick — instrumentation/set-next-strike-target-discarded: a posed target that
// is out of range on the firing tick is discarded: the strike lands on an
// eligible enemy and `nextStrikeTarget` reads `null`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextStrikeTarget(id)`): "A firing on which it is dead or out
// of range discards it and draws every strike at random." specs/weapons.md
// ("Spark"): "Spark's eligible targets are the enemies within `SPARK_RANGE`".
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with one moth inside the
// range and the posed moth moved through `setEnemyPosition` to `SPARK_RANGE +
// 1` units out after the pose, so the pose was valid when made and is out of
// range on the firing tick; Spark at level 1 lands one strike, which can only
// be on the eligible moth.
//
// THE TOLERANCE. `POSITION_TOL` on the strike's center against the eligible
// moth's, a copy.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNull } from "../assert";
import { SPARK_RANGE } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  newZones,
  placeEnemy,
  type Harness,
} from "../harness";
import {
  SPARK,
  TARGET_RING,
  assertCenteredOn,
  strikesOf,
} from "../spark/stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards a target out of range on the firing tick and strikes an eligible enemy", async () => {
  await isolate(h);
  const eligible = await placeEnemy(h, "moth", TARGET_RING, 0);
  const posed = await placeEnemy(h, "moth", -TARGET_RING, 0);
  await h.debug.setNextStrikeTarget(posed.id);
  await h.debug.setEnemyPosition(posed.id, -(SPARK_RANGE + 1), 0);

  const firing = await fireWeapon(h, SPARK, 1);
  await captureStill(h, "discarded");

  const strikes = strikesOf(newZones(firing.before, firing.after));
  assertLength(strikes, 1, "strikes the level-1 firing landed");
  assertCenteredOn(strikes[0]!, eligible, "the strike, on the eligible moth");
  assertNull(
    firing.after.run.nextStrikeTarget,
    "nextStrikeTarget after the firing",
  );
});
