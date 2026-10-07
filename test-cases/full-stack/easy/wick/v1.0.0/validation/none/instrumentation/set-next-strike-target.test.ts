// Wick — instrumentation/set-next-strike-target: `setNextStrikeTarget(id)` on
// `playing` sets `nextStrikeTarget` to that id, the snapshot reads it back,
// and the next Spark firing's first strike lands on that enemy.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Drawn
// outcomes", `setNextStrikeTarget(id)`): "The first strike of the next Spark
// firing lands on that enemy when it is alive and within `SPARK_RANGE` of the
// player's center on the tick of the firing". specs/weapons.md ("Spark"): a
// strike zone is centered on the target it landed on.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with four owls on the
// target ring of `spark/stage`, well inside `SPARK_RANGE`, Spark at level 1,
// whose row lands one strike, armed through `setWeaponCooldown` before each
// firing tick. The posed target is the third owl, so a build that always
// struck the first or the nearest is told from one that took the pose.
// `TRIALS` (`10`) firings are read under the same pose, so a build that took
// it by chance one in four is caught. An owl's `2000` hp outlives ten strikes
// of `15`, so the same four owls stand for every firing.
//
// THE TOLERANCE. `POSITION_TOL` on the strike's center against the posed
// owl's, a copy.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  newZones,
  type Harness,
} from "../harness";
import {
  SPARK,
  assertCenteredOn,
  placeTargets,
  ringPoints,
  strikesOf,
} from "../spark/stage";

const POINTS = ringPoints(4);
const POSED_INDEX = 2;
const TRIALS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the next strike's target, and the strike lands on it", async () => {
  await isolate(h);
  const slot = await holdWeapon(h, SPARK, 1);
  await enable(h, "weaponFire");
  const owls = await placeTargets(h, "owl", POINTS);
  const posed = owls[POSED_INDEX]!;

  let before = await h.snapshot();
  for (let trial = 1; trial <= TRIALS; trial += 1) {
    await h.debug.setNextStrikeTarget(posed.id);
    assertEqual(
      (await h.snapshot()).run.nextStrikeTarget,
      posed.id,
      `nextStrikeTarget after the pose, trial ${trial}`,
    );
    await armWeapon(h, slot);
    const after = await h.step(1);
    if (trial === TRIALS) await captureStill(h, "struck");

    const strikes = strikesOf(newZones(before, after));
    assertLength(
      strikes,
      1,
      `strikes the level-1 firing landed, trial ${trial}`,
    );
    assertCenteredOn(strikes[0]!, posed, `trial ${trial}`);
    before = after;
  }
});
