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
//     candidate.
//
// WHAT IS READ. `CHESTS` (10) chests on one night, each opened over the same
// maxed Taper and Brass posed back to level 1: every one reports
// `{ kind: "level", item: "brass", level: 2 }`, leaves Brass at level 2, and
// leaves Taper at level 8. A build that counts a maxed weapon among the
// candidates draws between two items and reports Taper, or raises it past its
// maximum, on some of the ten.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper maxed without its recipe passive, so
// nothing is eligible to evolve and the maxed weapon is the item that must be
// skipped; Brass at level 1 as the single candidate, so a conformant build's
// answer is fixed by the rule and every chest reads the same; nothing on the
// field and every driver switch off. Each overlay is left through
// `setScreen("playing")` and Brass is posed back through `setPassive`.
//
// TOLERANCE. None on any reading: an id and whole levels, each fixed by the
// rule on every chest. Ten chests are opened because a build that wrongly
// counts the maxed weapon still lands on Brass by chance on a given chest, and
// ten independent draws leave that under one in a thousand.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
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

/** How many chests are opened. */
const CHESTS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("levels Brass and leaves the maxed Taper at 8 on every one of ten chests", async () => {
  assertEqual(
    PASSIVE_LEVEL < PASSIVES[PASSIVE].maxLevel,
    true,
    "whether the posed Brass level is below its max",
  );

  poseChestNight(h);
  const slot = holdWeapon(h, WEAPON, MAX_WEAPON_LEVEL);
  for (let chest = 1; chest <= CHESTS; chest += 1) {
    h.debug.setPassive(0, PASSIVE, PASSIVE_LEVEL);

    const after = await openChest(h);
    if (chest === CHESTS) captureStill(h, "skipped");

    assertDeepEqual(
      chestResult(after, `chest ${chest}`),
      { kind: "level", item: PASSIVE, level: PASSIVE_LEVEL + 1 },
      `the result of chest ${chest}`,
    );
    assertEqual(
      after.run.passives[passiveSlot(after, PASSIVE)]?.level,
      PASSIVE_LEVEL + 1,
      `Brass's level after chest ${chest}`,
    );
    assertSlotHolds(
      after,
      slot,
      WEAPON,
      MAX_WEAPON_LEVEL,
      `the slot the maxed Taper was posed in, after chest ${chest}`,
    );
    if (after.screen === "chest") h.debug.setScreen("playing");
  }
});
