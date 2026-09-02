// Wick — spark/distinct-targets: amount `n` strikes land on `n` distinct
// enemies.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center"; ("Shapes and overlap"): "Every zone's position is the center of
// its shape", and the strike covers "every other enemy within `area` of the
// target's center", so each strike zone is centered on the enemy it landed
// on. Row 2 of `SPARK_LEVELS` gives amount `2`, and with no Lure held
// `amountBonus` is `0` (`specs/passives.md`). So with three moths in range
// the firing tick creates two strike zones, centered on two different moths.
//
// THE POSE. An isolated night with the lamplighter at the origin and three
// moths on the target ring at distinct directions, `200` out, then Spark held
// at level 2 and fired through the shared `fireWeapon`. `enemyMotion` is held
// so the moths stand where they were posed on the firing tick. The three are
// `120` degrees apart, `346` units from each other, so no strike's splash of
// `40` reaches a second moth and a zone centered on one moth is centered on
// no other. Which two of the three are struck is the build's draw.
//
// TOLERANCE. `POSITION_TOL` on each strike's center against a posed moth's
// center; the strike count and the distinctness are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, fail } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { SPARK, placeTargets, ringPoints, strikesOf, targetOf } from "./stage";

/** The level whose row carries amount `2`. */
const LEVEL = 2;

/** The three moths in range, on the target ring. */
const MOTHS = ringPoints(3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates two strike zones at level 2, centered on two different of three moths in range", async () => {
  assertEqual(weaponRow(SPARK, LEVEL).amount, 2, "row 2's amount");
  await isolate(h);
  await placeTargets(h, "moth", MOTHS);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "distinct");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    2,
    "Spark strike zones the level-2 firing tick created with three moths in range",
  );
  const struck = strikes.map((zone) => {
    const index = targetOf(zone, MOTHS);
    if (index < 0) {
      fail(`strike ${zone.id} centered on one of the posed moths`, {
        x: zone.x,
        y: zone.y,
      });
    }
    return index;
  });
  assertNotEqual(struck[0], struck[1], "the moths the two strikes landed on");
});
