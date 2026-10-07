// Wick — spark/range-boundary-inclusive: an enemy at exactly `SPARK_RANGE` is
// in range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): strikes land
// "among the live enemies within `SPARK_RANGE` (`600`) of the player's
// center"; ("Shapes and overlap"): "An enemy is within `d` of a point when
// the distance from that point to the enemy's center is at most `d`". So a
// moth whose center is exactly `600` from the lamplighter's center is an
// eligible target, and with it the only enemy alive the level-1 firing tick
// creates one strike zone centered on it, and it takes row 1's `15`.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// at `(600, 0)`, a distance a build computes exactly whether it compares the
// distance or its square; then Spark held at level 1 and fired through the
// shared `fireWeapon`. `enemyMotion` is held so the moth stands at `600` on
// the firing tick. A moth's `5` hp is below the `15`, so it reads as gone.
//
// TOLERANCE. `POSITION_TOL` on the strike's center against the moth's posed
// center; the strike count and the moth's fate are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SPARK_RANGE, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SPARK, assertCenteredOn, assertStruck, strikesOf } from "./stage";

/** The level whose row is fired: one strike of damage `15`. */
const LEVEL = 1;

/** The one moth, exactly `SPARK_RANGE` out along `+x`. */
const MOTH = { x: SPARK_RANGE, y: 0 };

/** Row 1's damage, `15`. */
const DAMAGE = weaponRow(SPARK, LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("strikes the only moth, standing exactly 600 from the lamplighter's center", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "boundary");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    1,
    "Spark strike zones the firing tick created with one moth at exactly 600",
  );
  assertCenteredOn(strikes[0]!, MOTH, "the strike on the moth at 600");
  assertStruck(firing.after, moth, DAMAGE, "the moth at 600");
});
