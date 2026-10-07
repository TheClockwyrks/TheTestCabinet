// Wick — oil-splash/row-7: row 7 of `OIL_SPLASH_LEVELS` is in force at
// level 7.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Oil Splash"), row 7
// of the table: damage `7`, cooldown `2.0`, radius `65`, duration
// `3.5`, amount `3`; ("Targeting summary") "row `i` is level `i + 1`", so
// level 7 reads this row. "On firing, `amount` puddles appear", each "a
// circle of `radius` that stays where it landed for `duration` seconds", and
// "each pulse deals `damage`"; ("Derived stats") the radius is the "table
// value × `areaMul`" and the damage the "table value × `damageMul`", both `1`
// with no passive held, the amount the "table value + `amountBonus`", `0`
// with none held, and the duration the "table value, unchanged"
// (`specs/passives.md`); and ("Cooldown timers") "After firing, the timer is
// set to the weapon's current cooldown", the table cooldown times a
// `cooldownMul` of `1`. So the firing tick creates 3 puddle zones of radius
// `65` carrying damage `7` and ttl `3.5`, and the slot reads `2.0` after it.
//
// THE POSE. An isolated night, and Oil Splash held at level 7 through
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
const LEVEL = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 3 puddle zones of radius 65 with damage 7 and ttl 3.5, and sets the timer to 2.0 at level 7", async () => {
  await checkOilRow(h, LEVEL);
});
