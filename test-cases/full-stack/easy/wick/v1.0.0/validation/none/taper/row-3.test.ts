// Wick — taper/row-3: row 3 of `TAPER_LEVELS` is in force at level 3.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"), row 3 of the
// table: damage `15`, cooldown `1.35`, width `120`, height `40`, amount
// `2`; ("Targeting summary") "row `i` is level `i + 1`", so level 3 reads
// this row. A slash "is a rectangle of `width × height`", and "With amount
// `2` a second slash fires on the same tick"; its lengths are the "table
// value × `areaMul`" and its damage the "table value × `damageMul`", both `1`
// with no passive held (`specs/passives.md`); and "After firing, the timer is
// set to the weapon's current cooldown", the table cooldown times a
// `cooldownMul` of `1`. So the firing tick creates 2 slash zones of `120 × 40`
// carrying damage `15`, and the slot reads `1.35` after it.
//
// THE POSE. An isolated night, facing posed right, and Taper held at level 3
// through `setWeapon` with its timer at `0`, fired by one tick with
// `weaponFire` on; the check itself is `checkTaperRow` in `taper/stage.ts`,
// which every row shares, so the eight points differ in the row alone.
//
// TOLERANCE. `POSITION_TOL` on the lengths, `FLOAT_TOL` on the damage,
// `TIMER_TOL` on the timer; the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkTaperRow } from "./stage";

/** The level this row is read at. */
const LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 2 slash zones of 120 x 40 with damage 15 and sets the timer to 1.35 at level 3", async () => {
  await checkTaperRow(h, LEVEL);
});
