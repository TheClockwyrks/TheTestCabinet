// Wick — lantern/row-4: row 4 of `LANTERN_LEVELS` is in force at level 4.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"), row 4 of
// the table: damage `15`, cooldown `3`, orbit `100`, radius `16`,
// duration `3.5`, amount `2`; ("Targeting summary") "row `i` is level
// `i + 1`", so level 4 reads this row. "On firing, `amount` lanterns appear
// on a circle of radius `orbit` around the player's center", "Each lantern is
// a circle of `radius`, and each is a zone with `ttl` set to `duration`";
// orbit and radius are the "table value × `areaMul`" and damage the "table
// value × `damageMul`", both `1` with no passive held (`specs/passives.md`),
// and amount is the table amount plus an `amountBonus` of `0`; and "On
// firing, Lantern's cooldown timer is set to `duration` plus the current
// cooldown", the table cooldown times a `cooldownMul` of `1`. So the firing
// tick creates 2 lantern zones of radius `16` carrying damage `15` and ttl
// `3.5`, each `100` from the lamplighter's center, and the slot reads
// `3.5 + 3 = 6.5` after it.
//
// THE POSE. An isolated night with Lantern held at level 4 through
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
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 2 lantern zones of radius 16 with damage 15 and ttl 3.5 on an orbit of 100 and sets the timer to 6.5 at level 4", async () => {
  await checkLanternRow(h, LEVEL);
});
