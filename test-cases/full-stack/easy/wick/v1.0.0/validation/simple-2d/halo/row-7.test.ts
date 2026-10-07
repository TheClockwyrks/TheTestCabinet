// Wick — halo/row-7: row 7 of HALO_LEVELS is in force at level 7.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): row 7 of the table has damage `6`,
//     cooldown `0.70`, and radius `110`; "Every level table has
//     `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`."
//   - `specs/weapons.md` ("Halo"): the aura's "`radius` and `damage` are
//     recomputed on every tick from the level, `areaMul`, and `damageMul` in
//     force on that tick", and on a pulse "every enemy whose circle overlaps
//     the aura takes `damage`, and the timer is set to the current cooldown".
//   - `specs/weapons.md` ("Derived stats"): damage is the "table value ×
//     `damageMul`", radius the "table value × `areaMul`", and the cooldown
//     the "table value × `cooldownMul`, floored at `MIN_COOLDOWN`"; with no
//     passive held every multiplier is `1` (`specs/passives.md`).
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's
//     damage per hit from the enemy's `hp`"; a rat has HP `15`, radius `12`
//     (`specs/enemies.md`).
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the pulse tick: the one aura zone's `radius` and
// `damage`, 110 and 6; the rat's `hp`, 15 − 6 = 9; and Halo's timer, 0.70.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 7, no passive held, one
// rat 40 units along +x inside the row's radius, every switch but `weaponFire`
// off, so the zone the tick creates is the aura alone, every figure read is
// the row's unscaled, and the pulse is the only thing that can touch the rat.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each figure: a stated figure, or a
// stated figure times a multiplier of 1, or an exact difference of two stated
// figures, read back.

import { afterEach, beforeEach, it } from "vitest";
import {
  armWeapon,
  captureStill,
  createHarness,
  present,
  type Harness,
} from "../harness";
import {
  ROW_PROBE,
  assertAuraOfRow,
  assertProbeTook,
  assertTimerOfRow,
  haloRow,
  poseHalo,
  theAura,
} from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 7;

/** Row 7 of HALO_LEVELS. */
const ROW = haloRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads radius 110 and damage 6, removes 6 from the rat, and sets the timer to 0.70 at level 7", async () => {
  const { slot, probe, posed } = poseHalo(h, LEVEL, ROW_PROBE);
  const rat = present(probe, "the posed rat's id");
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "row");

  assertAuraOfRow(theAura(after, "after the pulse tick"), ROW, "the aura");
  assertProbeTook(posed, after, rat, ROW.damage, "the rat after the pulse");
  assertTimerOfRow(after, slot, ROW);
});
