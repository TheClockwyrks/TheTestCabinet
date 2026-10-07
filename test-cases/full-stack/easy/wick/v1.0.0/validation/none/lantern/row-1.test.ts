// Wick — lantern/row-1: row 1 of `LANTERN_LEVELS` is in force at level 1.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"), row 1 of
// the table: damage `10`, cooldown `3`, orbit `90`, radius `14`,
// duration `3`, amount `1`; ("Targeting summary") "row `i` is level
// `i + 1`", so level 1 reads this row. "On firing, `amount` lanterns appear
// on a circle of radius `orbit` around the player's center", "Each lantern is
// a circle of `radius`, and each is a zone with `ttl` set to `duration`";
// orbit and radius are the "table value × `areaMul`" and damage the "table
// value × `damageMul`", both `1` with no passive held (`specs/passives.md`),
// and amount is the table amount plus an `amountBonus` of `0`; and "On
// firing, Lantern's cooldown timer is set to `duration` plus the current
// cooldown", the table cooldown times a `cooldownMul` of `1`. So the firing
// tick creates 1 lantern zone of radius `14` carrying damage `10` and ttl
// `3`, each `90` from the lamplighter's center, and the slot reads
// `3 + 3 = 6` after it.
//
// THE POSE. An isolated night with Lantern held at level 1 through
// `setWeapon` with its timer at `0`, fired by one tick with `weaponFire` on;
// the check itself is `checkLanternRow` in `lantern/stage.ts`, which every row
// shares, so the eight points differ in the row alone.
//
// TOLERANCE. `POSITION_TOL` on the radius and the orbit, `FLOAT_TOL` on the
// damage, `TIMER_TOL` on the ttl and the timer; the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkLanternRow } from "./stage";

/** The level this row is read at. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 1 lantern zone of radius 14 with damage 10 and ttl 3 on an orbit of 90 and sets the timer to 6 at level 1", async () => {
  await checkLanternRow(h, LEVEL);
});
