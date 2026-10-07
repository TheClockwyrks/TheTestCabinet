// Wick — taper/row-1: row 1 of `TAPER_LEVELS` is in force at level 1.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"), row 1 of the
// table: damage `10`, cooldown `1.35`, width `120`, height `40`, amount
// `1`; ("Targeting summary") "row `i` is level `i + 1`", so level 1 reads
// this row. A slash "is a rectangle of `width × height`"; its lengths are the
// "table value × `areaMul`" and its damage the "table value × `damageMul`",
// both `1` with no passive held (`specs/passives.md`); and "After firing, the
// timer is set to the weapon's current cooldown", the table cooldown times a
// `cooldownMul` of `1`. So the firing tick creates 1 slash zone of `120 × 40`
// carrying damage `10`, and the slot reads `1.35` after it.
//
// THE POSE. An isolated night, facing posed right, and Taper held at level 1
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
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates 1 slash zone of 120 x 40 with damage 10 and sets the timer to 1.35 at level 1", async () => {
  await checkTaperRow(h, LEVEL);
});
