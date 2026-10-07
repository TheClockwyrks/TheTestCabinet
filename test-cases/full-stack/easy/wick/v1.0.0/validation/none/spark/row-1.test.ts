// Wick — spark/row-1: row 1 of `SPARK_LEVELS` is in force at level 1.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"), row 1 of
// the table: damage `15`, cooldown `2.0`, area `40`, amount `1`;
// ("Targeting summary") "row `i` is level `i + 1`", so level 1 reads this
// row. "On firing, `amount` strikes land, each on a distinct enemy ...
// within `SPARK_RANGE`", and "A strike deals `damage` to its target ... on
// the tick it lands"; ("Shapes and overlap") "a strike's `radius` is its
// `area`"; ("Derived stats") the area is the "table value × `areaMul`" and
// the damage the "table value × `damageMul`", both `1` with no passive held,
// and the amount the "table value + `amountBonus`", `0` with no Lure held
// (`specs/passives.md`); ("Hits and death") "A hit removes the shape's damage
// per hit from the enemy's `hp`"; and "After firing, the timer is set to the
// weapon's current cooldown", the table cooldown times a `cooldownMul` of
// `1`. So with 1 hound in range the firing tick creates 1 strike zone of
// radius `40` carrying damage `15`, one centered on each hound, each hound's
// hp falls by `15`, and the slot reads `2.0` after it.
//
// THE POSE. An isolated night with 1 hound on the target ring, `200` out
// and evenly spaced, and Spark held at level 1 through `setWeapon` with
// its timer at `0`, fired by one tick with `weaponFire` on; the check itself
// is `checkSparkRow` in `spark/stage.ts`, which every row shares, so the
// eight points differ in the row alone. A hound's `120` hp outlives the
// `15`, so the removal reads exactly.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and each hound's hp;
// `POSITION_TOL` on each strike's center; `TIMER_TOL` on the timer; the
// count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkSparkRow } from "./stage";

/** The level this row is read at. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 1 strike zone of radius 40 with damage 15 on 1 hound and sets the timer to 2.0 at level 1", async () => {
  await checkSparkRow(h, LEVEL);
});
