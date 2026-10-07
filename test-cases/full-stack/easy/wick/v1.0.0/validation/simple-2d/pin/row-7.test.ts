// Wick — pin/row-7: row 7 of `PIN_LEVELS` is in force at level 7.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Pin"), the level table's row 7: "| 7 | 12 | 0.40 |
//     600 | 6 | 3 | 1.5 | 4 |", damage, cooldown, speed, radius, pierce,
//     duration, and amount in that order; ("Targeting summary"): "row `i` is
//     level `i + 1`".
//   - `specs/weapons.md` ("Pin"): "A dart is a circle of `radius`, fired
//     horizontally in the facing direction at `speed`, and removed after
//     `duration` seconds. Its pierce is the table `pierce`", and "Amount `n`
//     darts fire on the same tick".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", amount "table value +
//     `amountBonus`", and "Speed, Pierce, Duration | table value, unchanged";
//     with no passive held every multiplier is `1` and `amountBonus` is `0`
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", which "is the table cooldown times
//     `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)": 0.4 here.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired"; `specs/world.md` ("One tick"),
//     phase 6: only a projectile "that existed before this tick counts its
//     `ttl` down", so a dart's `ttl` reads `duration` after its firing tick.
//   - `specs/instrumentation.md` (`setWeapon`): "`level` is `1` to
//     `MAX_WEAPON_LEVEL` for a base weapon"; (`setWeaponCooldown`):
//     "`setWeaponCooldown(slot, 0)` makes that the next tick".
//
// WHAT IS READ. The Pin darts after the firing tick, and Pin's timer: exactly
// 4 projectiles, each of radius 6 with damage 12, speed 600 as the
// length of its velocity, pierce 3, and ttl 1.5; and the timer at 0.4. One
// item per row, so a build whose table has one row wrong fails the row it
// got wrong and no other.
//
// WHY THE NIGHT IS POSED AS IT IS. Pin alone at level 7, nothing on the
// field, every switch off but `weaponFire`. Pin needs no target, so the field
// stays empty and nothing can hit a dart; `effectMotion` off holds each dart
// at its launch velocity for the reading, as phase 6 would anyway before its
// first move. No passive is held, so every figure is the table's own.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each real figure (radius, damage, speed,
// ttl, and the timer), stated figures read back as doubles. None on the count
// and the pierce, whole numbers.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { derived } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armPin, assertDartOfRow, assertTimerOfRow, pinRow } from "./dart";

/** The level held, and the row of PIN_LEVELS it reads. */
const LEVEL = 7;
const ROW = pinRow(LEVEL);

/** The darts one firing produces: the row's amount plus `amountBonus`, `0`. */
const AMOUNT = ROW.amount + derived.amountBonus({});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 4 level-7 darts of row 7's figures and sets the timer to 0.4", async () => {
  const { slot } = armPin(h, LEVEL);

  const after = await h.tick(1);
  captureStill(h, "row");

  const darts = projectilesOf(after, "pin");
  assertLength(darts, AMOUNT, "Pin darts after the firing tick");
  for (const dart of darts) {
    assertDartOfRow(dart, ROW, `dart ${dart.id}`);
  }
  assertTimerOfRow(after, slot, ROW);
});
