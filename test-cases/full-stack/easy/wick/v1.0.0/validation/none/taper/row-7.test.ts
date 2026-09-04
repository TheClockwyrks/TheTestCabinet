// Wick — taper/row-7: row 7 of `TAPER_LEVELS` is in force at level 7.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"), row 7 of the
// table: damage `25`, cooldown `1.2`, width `140`, height `48`, amount
// `2`; ("Targeting summary") "row `i` is level `i + 1`", so level 7 reads
// this row. A slash "is a rectangle of `width × height`", and "With amount
// `2` a second slash fires on the same tick"; its lengths are the "table
// value × `areaMul`" and its damage the "table value × `damageMul`", both `1`
// with no passive held (`specs/passives.md`); and "After firing, the timer is
// set to the weapon's current cooldown", the table cooldown times a
// `cooldownMul` of `1`. So the firing tick creates 2 slash zones of `140 × 48`
// carrying damage `25`, and the slot reads `1.2` after it.
//
// THE POSE. An isolated night, facing posed right, and Taper held at level 7
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
const LEVEL = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 2 slash zones of 140 x 48 with damage 25 and sets the timer to 1.2 at level 7", async () => {
  await checkTaperRow(h, LEVEL);
});
