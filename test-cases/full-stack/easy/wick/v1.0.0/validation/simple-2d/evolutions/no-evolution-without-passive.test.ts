// Wick — evolutions/no-evolution-without-passive: a maxed base without its
// recipe passive does not evolve.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("The recipe"): "A base weapon is eligible to
//     evolve when all three hold at once: it is held at `MAX_WEAPON_LEVEL`
//     (`8`); the passive its recipe names is held, at any level; the player
//     opens a chest." The recipe table pairs Taper with Wick alone.
//   - `specs/evolutions.md` ("Opening a chest"): the result is "decided by the
//     first of these rules that applies", so with nothing eligible the chest
//     falls to rule 2, Level, or rule 3, Heal.
//   - `specs/evolutions.md` ("What an evolution is"): an evolution "replaces
//     its base in the same slot", so a build that evolved shows Pyre in the
//     loadout as well as in the result.
//   - `specs/passives.md`: Oil is a passive of its own, named by Beacon's
//     recipe rather than Pyre's, so holding it satisfies no condition of
//     Taper's recipe.
//
// WHAT IS READ. After the collecting tick: `chestResult` is not an `evolve`,
// no evolved weapon stands in any slot, and Taper is still held at level 8, the
// level it was posed at, since a maxed base weapon is no candidate for the
// chest's Level rule either.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at the maximum, so the level condition
// holds and the missing passive is the only thing that can refuse the
// evolution; Oil held rather than no passive at all, so the chest has an item
// below its max to level and the reading is about the recipe rather than about
// an empty loadout; nothing on the field and every driver switch off.
//
// TOLERANCE. None: a result kind, an id, and a whole level.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EVOLUTIONS, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { assertNothingEvolved, assertSlotHolds, poseChestNight } from "./chest";

/** The evolution the recipe would give: Pyre, from Taper with Wick. */
const EVOLUTION = "pyre";
const BASE = EVOLUTIONS[EVOLUTION].from;

/** A passive Taper's recipe does not name: Beacon's, not Pyre's. */
const OTHER_PASSIVE = EVOLUTIONS.beacon.passive;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Taper held at 8 and reports no evolution with Oil held but no Wick", async () => {
  poseChestNight(h);
  const slot = holdWeapon(h, BASE, MAX_WEAPON_LEVEL);
  holdPassive(h, OTHER_PASSIVE, 1);
  assertEqual(
    EVOLUTIONS[EVOLUTION].passive === OTHER_PASSIVE,
    false,
    "whether the passive held is the one Taper's recipe names",
  );

  const after = await openChest(h);
  captureStill(h, "held");

  assertNothingEvolved(after, "the chest collected with no Wick held");
  assertSlotHolds(
    after,
    slot,
    BASE,
    MAX_WEAPON_LEVEL,
    "the slot Taper was posed in",
  );
});
