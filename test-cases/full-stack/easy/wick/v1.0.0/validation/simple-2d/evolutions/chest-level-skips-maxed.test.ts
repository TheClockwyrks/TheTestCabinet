// Wick — evolutions/chest-level-skips-maxed: the chest's level result passes
// over an item already at its maximum.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 2: "One held item below
//     its max level, a base weapon below `MAX_WEAPON_LEVEL` or a passive below
//     its own max, is chosen uniformly at random ... and rises by `1`."
//   - `specs/evolutions.md` ("The recipe"): Taper evolves only beside Wick, and
//     no Wick is held, so rule 1 does not apply; ("What an evolution is") "A
//     base weapon with no recipe never evolves: at `MAX_WEAPON_LEVEL` a chest
//     passes it over, and it is neither evolved nor leveled."
//   - `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`;
//     `specs/passives.md`: Brass has `maxLevel` `3`, so Brass at level 1 is the
//     one item below its maximum and rule 2's uniform draw has exactly one
//     candidate, whatever the generator holds.
//   - `specs/instrumentation.md` (`reset`): "`options.seed` seeds the
//     generator", which is what makes the same night repeatable from a
//     different draw.
//
// WHAT IS READ. Ten nights, each reset with its own seed and posed with the
// same maxed Taper and level-1 Brass: every one reports
// `{ kind: "level", item: "brass", level: 2 }`, leaves Brass at level 2, and
// leaves Taper at level 8. A build that counts a maxed weapon among the
// candidates draws between two items and reports Taper, or raises it past its
// maximum, on some of the ten.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper maxed without its recipe passive, so
// nothing is eligible to evolve and the maxed weapon is the item that must be
// skipped; Brass at level 1 as the single candidate, so a conformant build's
// answer is fixed by the rule rather than by the generator and every seed reads
// the same; nothing on the field and every driver switch off.
//
// TOLERANCE. None on any reading: an id and whole levels, each fixed by the
// rule on every seed. Ten seeds are drawn because a build that wrongly counts
// the maxed weapon still lands on Brass by chance on a given seed, and ten
// independent draws leave that under one in a thousand.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { DEFAULT_SEED, MAX_WEAPON_LEVEL, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  passiveSlot,
  type Harness,
} from "../harness";
import { assertSlotHolds, chestResult, poseChestNight } from "./chest";

/** The maxed weapon the chest must skip. */
const WEAPON = "taper";

/** The one item below its maximum: Brass, whose maxLevel is 3. */
const PASSIVE = "brass";
const PASSIVE_LEVEL = 1;

/** How many seeds are sampled, each one night with one chest. */
const SEEDS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Brass and leaves the maxed Taper at 8 on every one of ten seeds", async () => {
  assertEqual(
    PASSIVE_LEVEL < PASSIVES[PASSIVE].maxLevel,
    true,
    "whether the posed Brass level is below its max",
  );

  for (let index = 0; index < SEEDS; index += 1) {
    const seed = DEFAULT_SEED + index;
    poseChestNight(h, seed);
    const slot = holdWeapon(h, WEAPON, MAX_WEAPON_LEVEL);
    holdPassive(h, PASSIVE, PASSIVE_LEVEL);

    const after = await openChest(h);
    if (index === SEEDS - 1) captureStill(h, "skipped");

    assertDeepEqual(
      chestResult(after, `the chest on seed ${seed}`),
      { kind: "level", item: PASSIVE, level: PASSIVE_LEVEL + 1 },
      `the chest's result on seed ${seed}`,
    );
    assertEqual(
      after.run.passives[passiveSlot(after, PASSIVE)]?.level,
      PASSIVE_LEVEL + 1,
      `Brass's level after the chest on seed ${seed}`,
    );
    assertSlotHolds(
      after,
      slot,
      WEAPON,
      MAX_WEAPON_LEVEL,
      `the slot the maxed Taper was posed in, on seed ${seed}`,
    );
  }
});
