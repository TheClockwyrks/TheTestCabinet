// Wick — taper/row-2: row 2 of TAPER_LEVELS is in force at level 2.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): row 2 of the table has damage `15`,
//     cooldown `1.35`, width `120`, height `40`, and amount `1`;
//     "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level
//     `i + 1`."
//   - `specs/weapons.md` ("Derived stats"): damage is the "table value ×
//     `damageMul`", width and height the "table value × `areaMul`", the
//     cooldown the "table value × `cooldownMul`, floored at `MIN_COOLDOWN`",
//     and amount the "table value + `amountBonus`"; with no passive held every
//     multiplier is `1` and the bonus `0` (`specs/passives.md`).
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown"; `specs/state.md` (`ZoneState`): a
//     slash's `width` and `height` are "the full extent of a slash's
//     rectangle, after the area multiplier" and `damage` "its damage per hit".
//   - `specs/weapons.md` ("Taper"): "Any amount above `TAPER_MAX_AMOUNT`
//     (`2`) adds nothing", and with amount 2 "a second slash fires on the
//     same tick", so the firing creates 1 slash zone.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick: the number of slash zones, 1;
// each slash's `width`, `height`, and `damage`, 120, 40, and 15; and Taper's
// timer, 1.35.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 2, no passive held,
// nothing on the field, every switch but `weaponFire` off, so the zones the
// tick creates are the slashes alone and every figure read is the row's,
// unscaled.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each figure: a stated figure, or a
// stated figure times a multiplier of 1, read back; none on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TAPER_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** The level this point holds Taper at. */
const LEVEL = 2;

/** Row 2 of TAPER_LEVELS. */
const ROW = TAPER_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 1 slash zone of 120 x 40 with damage 15 and sets the timer to 1.35 at level 2", async () => {
  const slot = armTaper(h, LEVEL, "right");

  const after = await h.tick(1);
  captureStill(h, "row");

  const slashes = zonesOfKind(after, "slash");
  assertEqual(slashes.length, ROW.amount, "slashes on the firing tick");
  for (const slash of slashes) {
    const which = `slash ${slash.id}`;
    assertWithin(
      slash.width ?? Number.NaN,
      ROW.width,
      FIGURE_TOLERANCE,
      `${which}: width`,
    );
    assertWithin(
      slash.height ?? Number.NaN,
      ROW.height,
      FIGURE_TOLERANCE,
      `${which}: height`,
    );
    assertWithin(
      slash.damage,
      ROW.damage,
      FIGURE_TOLERANCE,
      `${which}: damage`,
    );
  }
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    ROW.cooldown,
    FIGURE_TOLERANCE,
    "Taper's timer after the firing",
  );
});
