// Wick — halo/ignores-amount: Halo ignores amount.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "one zone of kind `aura`", and "Amount is
//     ignored."; ("Amount") "A weapon's amount is the table amount plus
//     `amountBonus` ... Halo and Flare ignore amount."
//   - `specs/passives.md` ("Amount"): "Halo, Corona, and Flare have no amount
//     and ignore `amountBonus`", and Mirror adds `MIRROR_AMOUNT_PER_LEVEL` (`1`)
//     per level to `amountBonus`, so Mirror at its `maxLevel` of `2` gives a
//     bonus of 2.
//   - `specs/weapons.md` ("Halo"): "every enemy whose circle overlaps the aura
//     takes `damage`" on a pulse, level 1 damage `3`; a moth has HP `5`
//     (`specs/enemies.md`); ("Hits and death") "A hit removes the shape's
//     damage per hit from the enemy's `hp`".
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on, so the pulse is posed onto tick 1.
//
// WHAT IS READ. After the first tick, the pulse tick, with Mirror 2 held:
// exactly one Halo aura zone, and the moth at 5 − 3 = 2, the row's damage
// removed once. A build that reads the bonus into Halo either creates a zone
// per amount or pulses the moth once per amount, and both readings catch it.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1 with Mirror at level
// 2 the only passive, one moth 40 units along +x inside the level-1 radius of
// 80, the timer posed to 0, every switch off but `weaponFire`: Mirror changes
// `amountBonus` and
// nothing else, so no other figure of the pulse moves, and nothing else can
// touch the moth or add a zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the hp: an exact difference of stated
// figures, read back as a double. None on the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  holdPassive,
  present,
  type Harness,
} from "../harness";
import { assertProbeTook, haloAuras, haloRow, poseHalo } from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** Mirror at its top level: an `amountBonus` of 2. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** Row 1's damage: what one pulse removes once, with no Wick held. */
const DAMAGE = haloRow(LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps one aura and removes the row's damage once with Mirror 2 held", async () => {
  const { slot, probe } = poseHalo(h, LEVEL);
  const moth = present(probe, "the posed moth's id");
  const mirror = holdPassive(h, "mirror", MIRROR_LEVEL);
  const posed = h.snapshot();
  assertEqual(posed.run.passives[mirror]?.id, "mirror", "the passive held");
  assertEqual(
    posed.run.passives[mirror]?.level,
    MIRROR_LEVEL,
    "Mirror's posed level",
  );
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "one");

  assertEqual(
    haloAuras(after).length,
    1,
    "aura zones with weapon halo after the pulse tick",
  );
  assertProbeTook(posed, after, moth, DAMAGE, "the moth after the pulse");
});
