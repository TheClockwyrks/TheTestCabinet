// lantern/row — the one check the eight row points of this category share,
// parameterized by level. CASE-PROVIDED.
//
// No review item names this file. Each row point holds Lantern at its level,
// runs the firing tick, and reads the set and the timer against the row of
// `LANTERN_LEVELS` in force; the eight points differ only in the level and the
// row, so the check is written once and each point states its level.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"), the level table: "Every level table has
//     `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`".
//   - `specs/weapons.md` ("Lantern"): "On firing, `amount` lanterns appear on
//     a circle of radius `orbit` around the player's center ... Each lantern
//     is a circle of `radius`, and each is a zone with `ttl` set to
//     `duration`", and "On firing, Lantern's cooldown timer is set to
//     `duration` plus the current cooldown, both read on that tick".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", orbit and radius "table value × `areaMul`", amount "table
//     value + `amountBonus`", and duration "table value, unchanged"; with no
//     passive held every multiplier is `1` and the bonus `0`
//     (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 5: the timer counts down and the
//     due weapon fires within the same tick, so the reading after that tick
//     is the freshly set figure; phase 6: only a zone "that existed before
//     this tick" counts its `ttl` down, so a new lantern reads the full
//     duration after the firing tick.
//
// WHAT IS READ. After the firing tick: the count of Lantern lanterns, the
// row's amount; each carrying the row's radius, damage, and duration as its
// `ttl`, and sitting the row's orbit from the lamplighter's center; and
// Lantern's timer, the row's duration plus its cooldown. Every figure of the
// row is asserted, so a build whose table departs from the specification in
// any column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at the level, no passive
// held, nothing on the field, every switch off but `weaponFire`, so the zones
// the tick creates are the lanterns alone and every figure read is the row's,
// unscaled; `effectMotion` off holds each lantern where the firing placed it.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, `ttl`, the orbit distance,
// and the timer, each a stated figure or a sum or product of stated figures
// read back as a double. None on the count, a whole number the row states.

import { captureStill, type Harness } from "../harness";
import { assertEqual } from "../assert";
import {
  armLantern,
  assertLanternOfRow,
  assertTimerOfRow,
  lanternRow,
  lanternsOf,
} from "./orbit";

/**
 * Hold Lantern at `level`, run the firing tick, keep the still, and read the
 * set and the timer against row `level`.
 */
export async function assertRowInForce(
  h: Harness,
  level: number,
): Promise<void> {
  const row = lanternRow(level);
  const orbit = armLantern(h, level);

  const after = await h.tick(1);
  captureStill(h, "row");

  const lanterns = lanternsOf(after);
  assertEqual(
    lanterns.length,
    row.amount,
    `Lantern lanterns after the firing tick at level ${level}`,
  );
  for (const lantern of lanterns) {
    assertLanternOfRow(lantern, row, orbit.player, `lantern ${lantern.id}`);
  }
  assertTimerOfRow(after, orbit.slot, row);
}
