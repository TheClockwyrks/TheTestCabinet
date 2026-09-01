// Wick — taper/row-7: row 7 of `TAPER_LEVELS` is in force at level 7.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"), the level table, row 7: damage 25,
//     cooldown 1.2, width 140, height 48, amount 2. "Every level table has
//     `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", width and height "table value × `areaMul`", cooldown
//     "table value × `cooldownMul`, floored at `MIN_COOLDOWN`", amount
//     "table value + `amountBonus`"; with no passive held every multiplier
//     is 1 and the bonus 0 (`specs/passives.md`), so each figure reads its
//     table value.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is
//     set to the weapon's current cooldown", so the slot reads 1.2 on the
//     firing tick.
//   - `specs/weapons.md` ("Shapes and overlap"): "a slash carries its
//     `width` and `height` with a `radius` of `0`"; ("Taper"): "With
//     amount `2` a second slash fires on the same tick", and a slash's
//     "damage per hit is fixed when the shape is created".
//   - `specs/instrumentation.md` (`setWeapon`): "Puts weapon `id` ... at
//     `level` in `slot`", and "`setWeaponCooldown(slot, 0)` makes that the
//     next tick."
//
// THE DRIVE. An isolated run with no enemy and no passive, Taper held at
// level 7 with its timer at 0, and `weaponFire` the one switch on. The
// firing tick runs once: 2 slash zones of width 140, height 48, damage 25,
// and radius 0, and the slot's timer reads 1.2.
//
// TOLERANCE. `REAL_EPS` on each figure, a table value times a multiplier of
// 1; the zone count is exact. The nearest rows differ by 5 damage, 0.15 s,
// 20 width, or 8 height, all far outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** The row under test. */
const LEVEL = 7;
const ROW = TAPER_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates 2 slash zones of 140 × 48 with damage 25 and sets the timer to 1.2 at level 7", async () => {
  isolate(h);
  const slot = armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "row");

  const slashes = zonesOfKind(after, "slash");
  assertEqual(
    slashes.length,
    ROW.amount,
    `the slashes the firing tick created at level ${LEVEL}`,
  );
  for (const z of slashes) {
    assertEqual(z.weapon, "taper", `slash ${z.id}'s weapon`);
    assertNear(
      z.width ?? Number.NaN,
      ROW.width,
      REAL_EPS,
      `slash ${z.id}'s width at level ${LEVEL}`,
    );
    assertNear(
      z.height ?? Number.NaN,
      ROW.height,
      REAL_EPS,
      `slash ${z.id}'s height at level ${LEVEL}`,
    );
    assertNear(
      z.damage,
      ROW.damage,
      REAL_EPS,
      `slash ${z.id}'s damage at level ${LEVEL}`,
    );
    assertNear(z.radius, 0, REAL_EPS, `slash ${z.id}'s radius`);
  }
  assertNear(
    after.run.weapons[slot].cooldown,
    ROW.cooldown,
    REAL_EPS,
    `Taper's timer after the firing at level ${LEVEL}`,
  );
});
