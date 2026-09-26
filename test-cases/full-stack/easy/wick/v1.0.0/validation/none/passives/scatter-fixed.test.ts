// Wick — passives/scatter-fixed: a scatter is the named constant at every
// passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` has
// each Oil Splash puddle "centered at an independent uniformly random point of
// the disk of radius `OIL_SCATTER` (`400`) about the player's center". So with
// Glass 5 held, `areaMul` `1.5`, every puddle still lands within `400`. The
// other two lengths the same sentence fixes are `passives/spread-fixed` and
// `passives/range-fixed`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, and Oil Splash held at level 1.
// `FIRINGS` (`20`) firings are driven, each the real way: the timer set to `0`
// and one tick. The landing points are read over all twenty, because a single
// random draw of a scatter scaled to `600` lands inside `400` four times in
// nine, and twenty independent draws do not.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each puddle's distance from the
// center. A scaled `OIL_SCATTER` reaches `600`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { OIL_SCATTER, POSITION_TOL, weaponRow } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  distanceBetween,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  newZones,
  type Harness,
  type ZoneView,
} from "../harness";

/** The Glass level held: `areaMul` `1.5`, the largest the passive allows. */
const GLASS_LEVEL = 5;

/** How many firings the scatter is read over. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every puddle inside 400 with Glass 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  const slot = await holdWeapon(h, "oil-splash", 1);
  await enable(h, "weaponFire");

  const puddles: ZoneView[] = [];
  for (let i = 0; i < FIRINGS; i += 1) {
    await armWeapon(h, slot);
    const before = await h.snapshot();
    const after = await h.step(1);
    puddles.push(
      ...newZones(before, after).filter((zone) => zone.weapon === "oil-splash"),
    );
  }
  await captureStill(h, "fixed");

  const at = opened.run.player;
  assertEqual(
    puddles.length,
    FIRINGS * (weaponRow("oil-splash", 1).amount ?? NaN),
    `puddles created over ${FIRINGS} firings`,
  );
  for (const puddle of puddles) {
    assertLessThanOrEqual(
      distanceBetween(at, puddle),
      OIL_SCATTER + POSITION_TOL,
      `puddle ${puddle.id}'s distance from the lamplighter's center`,
    );
  }
});
