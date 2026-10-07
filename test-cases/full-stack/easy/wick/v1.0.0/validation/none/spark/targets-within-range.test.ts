// Wick — spark/targets-within-range: a strike lands on an enemy within
// `SPARK_RANGE`, and on no enemy beyond it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "On firing,
// `amount` strikes land, each on a distinct enemy chosen uniformly at random
// among the live enemies within `SPARK_RANGE` (`600`) of the player's center";
// ("Shapes and overlap"): "An enemy is within `d` of a point when the distance
// from that point to the enemy's center is at most `d`", and "Every zone's
// position is the center of its shape". "A strike deals `damage` to its
// target ... on the tick it lands." Row 1 of `SPARK_LEVELS` gives amount `1`
// and damage `15`. So with one moth `599` from the lamplighter's center and
// one `601`, the firing tick creates one strike zone centered on the moth at
// `599`, that moth takes the `15`, and the moth at `601` is untouched.
//
// THE POSE. An isolated night with the lamplighter at the origin, one moth at
// `(599, 0)` and one at `(-601, 0)`, on opposite sides so the far moth is
// `1200` from the strike's center and outside its `area` of `40`; then Spark
// held at level 1 and fired through the shared `fireWeapon` (held, due,
// `weaponFire` on, one tick). `enemyMotion` is held so both moths stand where
// they were posed on the firing tick. A moth's `5` hp is below the `15`, so
// the struck moth reads as gone and the other as present at `5`.
//
// TOLERANCE. `POSITION_TOL` on the strike's center against the near moth's
// posed center, which the firing copies rather than integrates; the strike
// count and the two moths' fates are exact.

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
import {
  SPARK,
  assertCenteredOn,
  assertStruck,
  assertUntouched,
  strikesOf,
} from "./stage";

/** The level whose row is fired: one strike of damage `15`. */
const LEVEL = 1;

/** The moth just inside the range, `599` out along `+x`. */
const NEAR = { x: SPARK_RANGE - 1, y: 0 };

/** The moth just outside it, `601` out along `-x`. */
const FAR = { x: -(SPARK_RANGE + 1), y: 0 };

/** Row 1's damage, `15`. */
const DAMAGE = weaponRow(SPARK, LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("strikes the moth at 599 alone, and leaves the moth at 601 untouched", async () => {
  await isolate(h);
  const near = await placeEnemy(h, "moth", NEAR.x, NEAR.y);
  const far = await placeEnemy(h, "moth", FAR.x, FAR.y);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "range");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    1,
    "Spark strike zones the firing tick created with one moth in range",
  );
  assertCenteredOn(strikes[0]!, NEAR, "the strike on the moth at 599");
  assertStruck(firing.after, near, DAMAGE, "the moth at 599");
  assertUntouched(firing.after, far, "the moth at 601");
});
