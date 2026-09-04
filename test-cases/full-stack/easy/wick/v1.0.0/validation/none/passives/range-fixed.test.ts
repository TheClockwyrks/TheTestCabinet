// Wick — passives/range-fixed: a range is the named constant at every passive
// level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` has
// Spark's "eligible targets are the enemies within `SPARK_RANGE` (`600`)" and
// "with none within it ... Spark does not fire". So with Glass 5 held,
// `areaMul` `1.5`, a lone enemy at `601` still draws no strike. The other two
// lengths the same sentence fixes are `passives/spread-fixed` and
// `passives/scatter-fixed`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, one hound one unit past
// `SPARK_RANGE`, and Spark held at level 1. `FIRINGS` (`20`) firings are
// driven, each the real way: the timer set to `0` and one tick. Every other
// faculty stays held, so the hound never moves closer.
//
// TOLERANCE. None: the count of strikes is exact. A scaled `SPARK_RANGE`
// reaches `900` and would strike on every firing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_RANGE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  newZones,
  placeEnemyNear,
  type Harness,
  type ZoneView,
} from "../harness";

/** The Glass level held: `areaMul` `1.5`, the largest the passive allows. */
const GLASS_LEVEL = 5;

/** Where the lone hound stands: one unit past `SPARK_RANGE`. */
const TARGET = SPARK_RANGE + 1;

/** How many firings the silence is read over. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps Spark silent at 601 with Glass 5 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await placeEnemyNear(h, "hound", TARGET, 0);
  const slot = await holdWeapon(h, "spark", 1);
  await enable(h, "weaponFire");

  const strikes: ZoneView[] = [];
  for (let i = 0; i < FIRINGS; i += 1) {
    await armWeapon(h, slot);
    const before = await h.snapshot();
    const after = await h.step(1);
    strikes.push(
      ...newZones(before, after).filter((zone) => zone.weapon === "spark"),
    );
  }
  await captureStill(h, "fixed");

  assertEqual(
    strikes.length,
    0,
    `strikes created over ${FIRINGS} firings with the only enemy at ${TARGET}`,
  );
});
