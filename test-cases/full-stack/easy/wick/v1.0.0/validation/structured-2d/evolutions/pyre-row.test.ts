// evolutions/pyre-row — PYRE_STATS is in force.
//
// WHERE THE THRESHOLD COMES FROM.
//   - `specs/evolutions.md` ("Pyre"), `PYRE_STATS`: damage 60, cooldown 1.2,
//     width 200, height 60, amount 2.
//   - `specs/evolutions.md` ("Pyre"): "Pyre is Taper's slash on both sides of
//     the player on every firing: two rectangles of `width × height` ... Its
//     amount is `2` plus `amountBonus`, capped at `TAPER_MAX_AMOUNT` (`2`)".
//   - `specs/evolutions.md` ("Passives still apply"): "damage is the fixed
//     damage times `damageMul`; cooldown is the fixed cooldown times
//     `cooldownMul` ... every width, height, radius, and orbit is the fixed
//     length times `areaMul`". No passive is held, so every multiplier is 1
//     and the bonus 0 (`specs/passives.md`), and each figure reads its row
//     value.
//   - `specs/state.md` (`ZoneState`): `kind` is "`slash` for a Taper or Pyre
//     slash", and "`width`, `height`: the full extent of a slash's rectangle".
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", so the slot reads 1.2 on the firing
//     tick.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy — Pyre is
// Taper's slash, and Taper "need[s] no target" (`specs/weapons.md`, Cooldown
// timers) — and no passive, Pyre held with its timer at 0, and `weaponFire`
// the one switch on. The firing tick runs once: two zones of kind `slash`
// carrying the row's figures, and the slot's timer at 1.2. WHERE the two sit
// is `pyre-both-sides`' point; the row holds wherever they are drawn.
//
// THE TOLERANCE. `REAL_EPS` on each figure, a row value times a multiplier of
// 1; the zone count and the kind are exact. The nearest figure Taper's own
// table carries is width 160 against this row's 200 and damage 30 against 60,
// both orders of magnitude outside the bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { PYRE_STATS, REAL_EPS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireEvolved } from "./evolved";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates two slash zones of width 200, height 60 and damage 60, and sets the timer to 1.2", async () => {
  const firing = await fireEvolved(h, "pyre");
  captureStill(h, "row");

  assertEqual(
    firing.zones.length,
    PYRE_STATS.amount,
    "the Pyre zones the firing tick created (specs/evolutions.md, Pyre)",
  );
  for (const slash of firing.zones) {
    assertEqual(
      slash.kind,
      "slash",
      `zone ${slash.id}'s kind (specs/state.md, ZoneState)`,
    );
    assertNear(
      slash.width ?? Number.NaN,
      PYRE_STATS.width,
      REAL_EPS,
      `slash ${slash.id}'s width (specs/evolutions.md, PYRE_STATS)`,
    );
    assertNear(
      slash.height ?? Number.NaN,
      PYRE_STATS.height,
      REAL_EPS,
      `slash ${slash.id}'s height (specs/evolutions.md, PYRE_STATS)`,
    );
    assertNear(
      slash.damage,
      PYRE_STATS.damage,
      REAL_EPS,
      `slash ${slash.id}'s damage (specs/evolutions.md, PYRE_STATS)`,
    );
  }
  assertNear(
    firing.after.run.weapons[firing.slot]?.cooldown ?? Number.NaN,
    PYRE_STATS.cooldown,
    REAL_EPS,
    "Pyre's timer after the firing (specs/weapons.md, Cooldown timers)",
  );
});
