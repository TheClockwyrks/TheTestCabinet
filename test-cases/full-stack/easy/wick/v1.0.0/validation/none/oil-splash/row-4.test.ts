// Wick — oil-splash/row-4: row 4 of `OIL_SPLASH_LEVELS` is in force at
// level 4.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"), row 4
// of the table: damage `5`, cooldown `2.5`, radius `55`, duration
// `3.0`, amount `2`; ("Targeting summary") "row `i` is level `i + 1`", so
// level 4 reads this row. "On firing, `amount` puddles appear", each "a
// circle of `radius` that stays where it landed for `duration` seconds", and
// "each pulse deals `damage`"; ("Derived stats") the radius is the "table
// value × `areaMul`" and the damage the "table value × `damageMul`", both `1`
// with no passive held, the amount the "table value + `amountBonus`", `0`
// with none held, and the duration the "table value, unchanged"
// (`specs/passives.md`); and ("Cooldown timers") "After firing, the timer is
// set to the weapon's current cooldown", the table cooldown times a
// `cooldownMul` of `1`. So the firing tick creates 2 puddle zones of radius
// `55` carrying damage `5` and ttl `3.0`, and the slot reads `2.5` after it.
//
// THE POSE. An isolated night, and Oil Splash held at level 4 through
// `setWeapon` with its timer at `0`, fired by one tick with `weaponFire` on;
// the check itself is `checkOilRow` in `oil-splash/stage.ts`, which every
// row shares, so the eight points differ in the row alone. Oil Splash needs
// no target, so no enemy is posed and the puddles pulse on nothing.
//
// TOLERANCE. `FLOAT_TOL` on the radius and the damage, `TIMER_TOL` on the ttl
// and the timer; the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkOilRow } from "./stage";

/** The level this row is read at. */
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 2 puddle zones of radius 55 with damage 5 and ttl 3.0, and sets the timer to 2.5 at level 4", async () => {
  await checkOilRow(h, LEVEL);
});
