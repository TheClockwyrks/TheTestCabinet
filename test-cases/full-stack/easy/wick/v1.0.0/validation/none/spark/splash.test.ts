// Wick — spark/splash: a strike hits every enemy within `area` of its target's
// center, and none beyond it.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "A strike
// deals `damage` to its target and to every other enemy within `area` of the
// target's center, on the tick it lands"; ("Shapes and overlap"): "An enemy is
// within `d` of a point when the distance from that point to the enemy's
// center is at most `d`". Row 1 of `SPARK_LEVELS` gives damage `15` and area
// `40`, the "table value × `areaMul`" with no Glass held (`specs/passives.md`).
// So a moth `35` from the struck target's center takes the `15` and a moth
// `45` from it does not.
//
// THE POSE. The target has to be the one enemy Spark may choose, so it is the
// only enemy in range: a hound at `(599, 0)`, `599` from the lamplighter's
// center, with the two moths on the same ray beyond it, at `(634, 0)` and
// `(644, 0)`, `634` and `644` from the lamplighter and so outside the range,
// and `35` and `45` from the hound's center. Spark is held at level 1 and
// fired through the shared `fireWeapon`; `enemyMotion` is held so all three
// stand where they were posed on the firing tick. The hound's `120` hp
// outlives the `15`, a moth's `5` does not, so the near moth reads as gone
// and the far one as present at `5`.
//
// TOLERANCE. `POSITION_TOL` on the strike's center against the hound's posed
// center, which fixes where the splash is measured from; `FLOAT_TOL` on the
// hound's hp; the two moths' fates are exact.

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

/** The level whose row is fired: damage `15`, area `40`. */
const LEVEL = 1;

/** Row 1, as fired. */
const ROW = weaponRow(SPARK, LEVEL);

/** The one enemy in range, the strike's target. */
const TARGET = { x: SPARK_RANGE - 1, y: 0 };

/** The moth `35` beyond the target on the same ray: inside the area of `40`. */
const INSIDE = { x: TARGET.x + ROW.area! - 5, y: 0 };

/** The moth `45` beyond it: outside the area. */
const OUTSIDE = { x: TARGET.x + ROW.area! + 5, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("damages a moth 35 from the struck target's center and leaves a moth 45 from it untouched", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", TARGET.x, TARGET.y);
  const inside = await placeEnemy(h, "moth", INSIDE.x, INSIDE.y);
  const outside = await placeEnemy(h, "moth", OUTSIDE.x, OUTSIDE.y);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "splash");

  const strikes = strikesOf(firing.zones);
  assertEqual(
    strikes.length,
    1,
    "Spark strike zones the firing tick created with one enemy in range",
  );
  assertCenteredOn(strikes[0]!, TARGET, "the strike on the hound");
  assertStruck(firing.after, hound, ROW.damage, "the hound struck");
  assertStruck(firing.after, inside, ROW.damage, "the moth 35 from the target");
  assertUntouched(firing.after, outside, "the moth 45 from the target");
});
