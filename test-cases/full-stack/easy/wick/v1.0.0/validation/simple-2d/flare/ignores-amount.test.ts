// Wick — flare/ignores-amount: Flare ignores amount.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`, read on the tick it fires. It counts the
//     projectiles, puddles, strikes, or lanterns one firing produces. Halo and
//     Flare ignore amount."
//   - `specs/weapons.md` ("Flare"): "amount is ignored".
//   - `specs/passives.md` ("Amount"): "Halo, Corona, and Flare have no amount
//     and ignore `amountBonus`"; Mirror adds `MIRROR_AMOUNT_PER_LEVEL` (`1`)
//     per level to `amountBonus`, and Mirror tops out at level `2`, so the
//     bonus posed here is 2.
//   - `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius` of
//     the player's center takes `damage` on that tick"; row 1 deals `100`.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`"; a mothwing has HP `600`
//     (`specs/enemies.md`), so it survives the burst and the hp it is left
//     with says how many times the damage landed.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick with Mirror at level 2 held: exactly one
// burst zone with weapon `flare`, and the mothwing at 600 − 100 = 500, the
// row's damage removed once. A build that reads the bonus into Flare either
// creates a burst per amount or applies the damage once per amount, and the
// two readings catch both.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 1 with Mirror at level
// 2 the only passive, one mothwing 100 units along +x well inside the row's
// radius of 640, every switch but `weaponFire` off. Mirror changes
// `amountBonus` and nothing else, so no other figure of the firing moves, and
// nothing else can touch the mothwing or add a zone.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the hp: an exact difference of
// stated figures, read back as a double. None on the count.

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
import { assertProbeTook, flareBursts, flareRow, poseFlare } from "./burst";

/** The level this point holds Flare at. */
const LEVEL = 1;

/** Mirror at its top level: an `amountBonus` of 2. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** Row 1's damage: what one burst removes once, with no Wick held. */
const DAMAGE = flareRow(LEVEL).damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps one burst and removes the row's damage once with Mirror 2 held", async () => {
  const { slot, probe } = poseFlare(h, LEVEL);
  const mothwing = present(probe, "the posed mothwing's id");
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
    flareBursts(after).length,
    1,
    "burst zones with weapon flare after the firing tick",
  );
  assertProbeTook(
    posed,
    after,
    mothwing,
    DAMAGE,
    "the mothwing after the burst",
  );
});
