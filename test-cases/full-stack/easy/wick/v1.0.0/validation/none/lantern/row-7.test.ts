// Wick — lantern/row-7: row 7 of `LANTERN_LEVELS` is in force at level 7.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"), row 7 of
// the table: damage `20`, cooldown `2.5`, orbit `110`, radius `18`,
// duration `4`, amount `3`; ("Targeting summary") "row `i` is level
// `i + 1`", so level 7 reads this row. "On firing, `amount` lanterns appear
// on a circle of radius `orbit` around the player's center", "Each lantern is
// a circle of `radius`, and each is a zone with `ttl` set to `duration`";
// orbit and radius are the "table value × `areaMul`" and damage the "table
// value × `damageMul`", both `1` with no passive held (`specs/passives.md`),
// and amount is the table amount plus an `amountBonus` of `0`; and "On
// firing, Lantern's cooldown timer is set to `duration` plus the current
// cooldown", the table cooldown times a `cooldownMul` of `1`. So the firing
// tick creates 3 lantern zones of radius `18` carrying damage `20` and ttl
// `4`, each `110` from the lamplighter's center, and the slot reads
// `4 + 2.5 = 6.5` after it.
//
// THE POSE. An isolated night with Lantern held at level 7 through
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
const LEVEL = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 3 lantern zones of radius 18 with damage 20 and ttl 4 on an orbit of 110 and sets the timer to 6.5 at level 7", async () => {
  await checkLanternRow(h, LEVEL);
});
