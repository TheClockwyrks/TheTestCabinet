// Wick — oil-splash/row-8: row 8 of `OIL_SPLASH_LEVELS` is in force at
// level 8.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"), the level table's row 8: "| 8 | 8 |
//     2.0 | 70 | 4.0 | 4 |", damage, cooldown, radius, duration, and amount
//     in that order; ("Targeting summary"): "row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles appear
//     ... A puddle is a circle of `radius` that stays where it landed for
//     `duration` seconds", and ("Amount"): amount "counts the projectiles,
//     puddles, strikes, or lanterns one firing produces".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", amount "table value +
//     `amountBonus`", and "Speed, Pierce, Duration | table value, unchanged";
//     with no passive held every multiplier is `1` and `amountBonus` is `0`
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", which "is the table cooldown times
//     `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)": 2 here.
//   - `specs/state.md` (`ZoneState`): `kind` is "`puddle` for an Oil Splash
//     or Blaze puddle" and `ttl` on "a puddle [is] its `duration`";
//     `specs/world.md` ("One tick"), phase 6: only a zone "that existed
//     before this tick counts its `ttl` down", so a puddle's `ttl` reads
//     `duration` after its firing tick.
//   - `specs/instrumentation.md` (`setWeapon`): "`level` is `1` to
//     `MAX_WEAPON_LEVEL` for a base weapon"; (`setWeaponCooldown`):
//     "`setWeaponCooldown(slot, 0)` makes that the next tick".
//
// WHAT IS READ. The Oil Splash puddles after the firing tick, and Oil
// Splash's timer: exactly 4 zones of kind `puddle`, each of radius 70 with
// damage 8 and ttl 4; and the timer at 2. One item per row, so a
// build whose table has one row wrong fails the row it got wrong and no
// other.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 8, nothing on
// the field, every switch off but `weaponFire`. Oil Splash needs no target,
// so the field stays empty and every puddle is still in `zones` with the
// figures it was created with. No passive is held, so every figure is the
// table's own.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each real figure (radius, damage,
// ttl, and the timer), stated figures read back as doubles. None on the
// count, a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { derived } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  armOilSplash,
  assertPuddleOfRow,
  assertTimerOfRow,
  oilRow,
  puddlesOf,
} from "./puddle";

/** The level held, and the row of OIL_SPLASH_LEVELS it reads. */
const LEVEL = 8;
const ROW = oilRow(LEVEL);

/** The puddles one firing produces: the row's amount plus `amountBonus`, `0`. */
const AMOUNT = ROW.amount + derived.amountBonus({});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 4 level-8 puddles of row 8's figures and sets the timer to 2", async () => {
  const { slot } = armOilSplash(h, LEVEL);

  const after = await h.tick(1);
  captureStill(h, "row");

  const puddles = puddlesOf(after);
  assertLength(puddles, AMOUNT, "Oil Splash puddles after the firing tick");
  for (const puddle of puddles) {
    assertPuddleOfRow(puddle, ROW, `puddle ${puddle.id}`);
  }
  assertTimerOfRow(after, slot, ROW);
});
