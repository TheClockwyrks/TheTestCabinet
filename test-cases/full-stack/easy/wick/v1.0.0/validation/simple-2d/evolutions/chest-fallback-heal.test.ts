// Wick — evolutions/chest-fallback-heal: a chest with nothing to evolve and
// nothing to level heals `CHEST_HEAL`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 3: "Heal. `hp` rises by
//     `CHEST_HEAL` (`30`), capped at `maxHp`. The result is `{ kind: "heal" }`."
//   - `specs/evolutions.md` ("Opening a chest"): the result is "decided by the
//     first of these rules that applies", so rule 3 is reached only with
//     nothing eligible to evolve and nothing below its maximum.
//   - `specs/evolutions.md` ("The recipe"): Taper evolves only beside Wick, and
//     Brass names no held weapon's recipe, so rule 1 does not apply;
//     `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`;
//     `specs/passives.md`: Brass has `maxLevel` `3`, so both held items sit at
//     their maxima and rule 2 has no candidate.
//   - `specs/world.md` ("Health and recovery"): "Every heal from any source,
//     bread, lamp-oil, a chest, or a weapon, adds to `hp` and caps it at the
//     `maxHp` in force"; `maxHp` is `BASE_MAX_HP` (`100`) with no Tallow held
//     (`specs/passives.md`), so 50 + 30 is below the cap and lands exactly.
//   - `specs/instrumentation.md` (`setHp`): "Sets `hp` to `hp`, a real number
//     at most `maxHp`".
//
// WHAT IS READ. After the collecting tick: `hp` reads 80, exactly `CHEST_HEAL`
// above the 50 it was posed at, and `chestResult` reads `{ kind: "heal" }`.
//
// WHY THE NIGHT IS POSED AS IT IS. One maxed weapon and one maxed passive, so
// the two earlier rules are both refused by the loadout rather than by an empty
// one; `hp` posed 50 below `maxHp`, so the whole of `CHEST_HEAL` fits under the
// cap and the reading is the figure rather than the cap; nothing on the field
// and every driver switch off, so no bread, no lamp oil, and no recovery can
// add health on the collecting tick, and `recovery` is `0` with no Tinder held.
//
// TOLERANCE. `FIGURE_TOLERANCE` on `hp`, an exact sum of two stated figures
// read back as a double. None on the result.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  CHEST_HEAL,
  FIGURE_TOLERANCE,
  MAX_WEAPON_LEVEL,
  PASSIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { chestResult, poseChestNight } from "./chest";

/** The maxed weapon: Taper, whose recipe passive is not held. */
const WEAPON = "taper";

/** The maxed passive: Brass, at its own `maxLevel` of 3. */
const PASSIVE = "brass";

/** The health the run is posed at, `CHEST_HEAL` clear of `maxHp`. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises hp from 50 to 80 and reports a heal with every held item maxed", async () => {
  assertEqual(
    POSED_HP + CHEST_HEAL <= BASE_MAX_HP,
    true,
    "the healed health against maxHp, so the cap does not decide the reading",
  );
  poseChestNight(h);
  holdWeapon(h, WEAPON, MAX_WEAPON_LEVEL);
  holdPassive(h, PASSIVE, PASSIVES[PASSIVE].maxLevel);
  h.debug.setHp(POSED_HP);
  assertWithin(
    h.snapshot().run.player.hp,
    POSED_HP,
    FIGURE_TOLERANCE,
    "the posed hp",
  );

  const after = await openChest(h);
  captureStill(h, "healed");

  assertWithin(
    after.run.player.hp,
    POSED_HP + CHEST_HEAL,
    FIGURE_TOLERANCE,
    "hp after the chest",
  );
  assertDeepEqual(
    chestResult(after, "the chest with nothing to evolve or level"),
    { kind: "heal" },
    "the chest's result",
  );
});
