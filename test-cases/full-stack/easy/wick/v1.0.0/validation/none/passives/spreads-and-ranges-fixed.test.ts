// Wick — passives/spreads-and-ranges-fixed: a spread, a scatter, and a range
// are the named constants at every passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` fixes
// each figure and the rule it feeds: Pin's dart `i` "starts at `x = player.x`
// and `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`" with `PIN_SPREAD` (`10`),
// so at amount `2` the two darts sit `10` apart, at `±5` about the
// lamplighter's `y`; Spark's "eligible targets are the enemies within
// `SPARK_RANGE` (`600`)" and "with none within it ... Spark does not fire"; and
// each Oil Splash puddle is "centered at an independent uniformly random point
// of the disk of radius `OIL_SCATTER` (`400`) about the player's center". So
// with Glass 5 held, `areaMul` `1.5`, a lone enemy at `TARGET` (`601`) draws no
// strike and every puddle still lands within `400`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, one hound at `601` along `+x`,
// and Pin at level 2, Spark at level 1, and Oil Splash at level 1 held
// together. `FIRINGS` (`20`) firings are driven, each the real path: every
// timer set to `0` through `setWeaponCooldown` and one tick. The spread is read
// off the darts of the first firing alone, so the later ones cannot confuse it;
// the strikes are counted over all twenty; and the puddles are read over all
// twenty, because a single random draw of a scatter scaled to `600` lands
// inside `400` four times in nine, and twenty independent draws do not. Every
// other faculty stays held, so nothing travels and the lamplighter stands at
// the origin throughout.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each dart's offset and on each puddle's
// distance from the center; the count of strikes is exact. A scaled
// `PIN_SPREAD` puts the darts `15` apart, a scaled `SPARK_RANGE` reaches `900`,
// and a scaled `OIL_SCATTER` reaches `600`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, assertNear } from "../assert";
import {
  OIL_SCATTER,
  PIN_SPREAD,
  POSITION_TOL,
  SPARK_RANGE,
  weaponRow,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  distanceBetween,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  newProjectiles,
  newZones,
  placeEnemyNear,
  type Harness,
  type ProjectileView,
  type ZoneView,
} from "../harness";

/** The Glass level held: `areaMul` `1.5`, the largest the passive allows. */
const GLASS_LEVEL = 5;

/** The Pin level held: table amount `2`. */
const PIN_LEVEL = 2;

/** The level Spark and Oil Splash are held at. */
const LEVEL = 1;

/** Where the lone hound stands: one unit past `SPARK_RANGE`. */
const TARGET = SPARK_RANGE + 1;

/** How many firings the scatter is read over. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps Pin's spread at 10, Spark silent at 601, and every puddle inside 400 with Glass 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await placeEnemyNear(h, "hound", TARGET, 0);
  const slots = [
    await holdWeapon(h, "pin", PIN_LEVEL),
    await holdWeapon(h, "spark", LEVEL),
    await holdWeapon(h, "oil-splash", LEVEL),
  ];
  await enable(h, "weaponFire");

  const darts: ProjectileView[][] = [];
  const strikes: ZoneView[] = [];
  const puddles: ZoneView[] = [];
  for (let i = 0; i < FIRINGS; i += 1) {
    for (const slot of slots) await armWeapon(h, slot);
    const before = await h.snapshot();
    const after = await h.step(1);
    darts.push(
      newProjectiles(before, after).filter((shot) => shot.weapon === "pin"),
    );
    const zones = newZones(before, after);
    strikes.push(...zones.filter((zone) => zone.weapon === "spark"));
    puddles.push(...zones.filter((zone) => zone.weapon === "oil-splash"));
  }
  await captureStill(h, "fixed");

  const at = opened.run.player;
  const first = darts[0] ?? [];
  assertEqual(
    first.length,
    weaponRow("pin", PIN_LEVEL).amount,
    "Pin darts the first firing created",
  );
  first.forEach((dart, i) => {
    assertNear(
      dart.y - at.y,
      (i - (first.length - 1) / 2) * PIN_SPREAD,
      POSITION_TOL,
      `dart ${i}'s offset from the lamplighter's y with Glass 5 held`,
    );
  });

  assertEqual(
    strikes.length,
    0,
    `strikes created over ${FIRINGS} firings with the only enemy at ${TARGET}`,
  );

  assertEqual(
    puddles.length,
    FIRINGS * (weaponRow("oil-splash", LEVEL).amount ?? NaN),
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
