// Wick — evolutions/evolved-never-chest-leveled: a chest never levels an
// evolved weapon.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("What an evolution is"): "An evolved weapon has a
//     single level and no level table: its figures are one fixed row ... and it
//     is never leveled further. It is never a level-up offer, and it is never
//     the item a chest levels."
//   - `specs/evolutions.md` ("Opening a chest"), rule 2 names "One held item
//     below its max level, a base weapon below `MAX_WEAPON_LEVEL` or a passive
//     below its own max", which an evolved weapon is neither of; rule 3: "Heal.
//     `hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`. The result is
//     `{ kind: "heal" }`."
//   - `specs/world.md` ("Health and recovery"): a heal "adds to `hp` and caps
//     it at the `maxHp` in force"; `maxHp` is `BASE_MAX_HP` (`100`) with no
//     Tallow held, so 50 + 30 lands under the cap.
//   - `specs/instrumentation.md` (`setWeapon`): "`level` is ... `1` for an
//     evolved one", which is how Pyre is held without a chest.
//
// WHAT IS READ. After the collecting tick: `chestResult` reads
// `{ kind: "heal" }`, `hp` reads 80, and Pyre still reads level `1`. A build
// that counts an evolved weapon among the chest's candidates reports a level
// result and leaves Pyre at level 2.
//
// WHY THE NIGHT IS POSED AS IT IS. Pyre alone, so the chest's only possible
// candidate is the evolved weapon itself and the heal is reached only by
// skipping it; `hp` posed 50 below `maxHp`, so the heal reads as a figure
// rather than as a cap; nothing on the field and every driver switch off.
//
// TOLERANCE. `FIGURE_TOLERANCE` on `hp`, an exact sum of two stated figures.
// None on the result or the level.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertWithin } from "../assert";
import { CHEST_HEAL, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { assertSlotHolds, chestResult, poseChestNight } from "./chest";

/** The evolved weapon held alone. */
const EVOLUTION = "pyre";

/** The health the run is posed at, `CHEST_HEAL` clear of `maxHp`. */
const POSED_HP = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("heals rather than leveling Pyre, and leaves Pyre at level 1", async () => {
  poseChestNight(h);
  const slot = holdWeapon(h, EVOLUTION, 1);
  h.debug.setHp(POSED_HP);

  const after = await openChest(h);
  captureStill(h, "skipped");

  assertDeepEqual(
    chestResult(after, "the chest opened with Pyre held alone"),
    { kind: "heal" },
    "the chest's result",
  );
  assertWithin(
    after.run.player.hp,
    POSED_HP + CHEST_HEAL,
    FIGURE_TOLERANCE,
    "hp after the chest",
  );
  assertSlotHolds(after, slot, EVOLUTION, 1, "the slot Pyre was posed in");
});
