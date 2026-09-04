// Wick — evolutions/pyre-row: `PYRE_STATS` is in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Pyre"), the fixed row `PYRE_STATS`: damage `60`,
//     cooldown `1.2`, width `200`, height `60`, amount `2`.
//   - `specs/evolutions.md` ("Pyre"): "Pyre is Taper's slash on both sides of
//     the player on every firing: two rectangles of `width × height` ... Its
//     amount is `2` plus `amountBonus`, capped at `TAPER_MAX_AMOUNT` (`2`)".
//   - `specs/evolutions.md` ("What an evolution is"): "An evolved weapon has a
//     single level and no level table: its figures are one fixed row".
//   - `specs/evolutions.md` ("Passives still apply"): "damage is the fixed
//     damage times `damageMul`; cooldown is the fixed cooldown times
//     `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`); every width, height,
//     radius, and orbit is the fixed length times `areaMul`"; with no passive
//     held every multiplier is `1` (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): a slash carries its `width` and `height`,
//     and `damage` is "its damage per hit"; `specs/weapons.md` ("Cooldown
//     timers"): "After firing, the timer is set to the weapon's current
//     cooldown", and `specs/world.md` ("One tick"), phase 5, has the timer
//     count down and the due weapon fire within the same tick, so the reading
//     after that tick is the freshly set figure.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick: the count of slash zones, `2`; each
// slash's `width`, `height`, and `damage`, 200, 60, and 60; and Pyre's timer,
// 1.2. Every figure of the row is asserted, so a build whose fixed row departs
// from the specification in any column fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Pyre alone, no passive held, nothing on the
// field, every driver switch but `weaponFire` off, so the zones the tick
// creates are the two slashes alone and every figure read is the fixed row's,
// unscaled.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each figure: a stated figure, or a
// stated figure times a multiplier of 1, read back. None on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, PYRE_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armEvolved, assertTimerAfterFiring } from "./evolved";

/** Pyre's fixed row. */
const ROW = PYRE_STATS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 2 slash zones of 200 x 60 with damage 60 and sets the timer to 1.2", async () => {
  const { slot } = armEvolved(h, "pyre", { facing: "right" });

  const after = await h.tick(1);
  captureStill(h, "row");

  const slashes = zonesOfKind(after, "slash");
  assertEqual(slashes.length, ROW.amount, "slash zones on the firing tick");
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
  assertTimerAfterFiring(
    after,
    slot,
    ROW.cooldown,
    "Pyre's timer after the firing",
  );
});
