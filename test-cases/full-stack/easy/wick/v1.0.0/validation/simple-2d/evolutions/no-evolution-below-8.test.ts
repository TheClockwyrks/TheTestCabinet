// Wick — evolutions/no-evolution-below-8: a base below `MAX_WEAPON_LEVEL` does
// not evolve, however its recipe passive stands.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("The recipe"): "A base weapon is eligible to
//     evolve when all three hold at once: it is held at `MAX_WEAPON_LEVEL`
//     (`8`); the passive its recipe names is held, at any level; the player
//     opens a chest." Taper at level `7` fails the first.
//   - `specs/evolutions.md` ("Opening a chest"): the result is "decided by the
//     first of these rules that applies", and with nothing eligible rule 1 is
//     passed over for rule 2, Level, or rule 3, Heal.
//   - `specs/evolutions.md` ("What an evolution is"): an evolution "replaces
//     its base in the same slot", so a build that evolved shows Pyre in the
//     loadout as well as in the result.
//   - `specs/instrumentation.md` (`setScreen`): the chest overlay "is reached
//     through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//     tick, which is the real collection path".
//
// WHAT IS READ. After the collecting tick: `chestResult` is not an `evolve`,
// no evolved weapon stands in any slot, and Taper is still held as a base
// weapon. Its level is left to the chest's Level rule, which Taper at 7 is a
// candidate for; this point decides the recipe's level condition alone, and the
// fallback's own points decide the rest.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at level 7, one below the maximum, and
// Wick held, so the recipe's other two conditions hold and the level condition
// is the only thing that can refuse the evolution; nothing else on the field
// and every driver switch off, so nothing else can reach the loadout on the
// collecting tick.
//
// TOLERANCE. None: a result kind, an id, and a whole level.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { EVOLUTIONS, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  weaponSlot,
  openChest,
  type Harness,
} from "../harness";
import { assertNothingEvolved, poseChestNight } from "./chest";

/** The evolution the recipe would give: Pyre, from Taper with Wick. */
const EVOLUTION = "pyre";
const BASE = EVOLUTIONS[EVOLUTION].from;
const PASSIVE = EVOLUTIONS[EVOLUTION].passive;

/** One level below the maximum: the whole of what refuses this recipe. */
const LEVEL = MAX_WEAPON_LEVEL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Taper a base weapon and reports no evolution with Taper at 7 and Wick held", async () => {
  poseChestNight(h);
  holdWeapon(h, BASE, LEVEL);
  holdPassive(h, PASSIVE, 1);

  const after = await openChest(h);
  captureStill(h, "held");

  assertNothingEvolved(after, "the chest collected with Taper at 7");
  const slot = weaponSlot(after, BASE);
  assertEqual(slot >= 0, true, "whether Taper is still held after the chest");
  assertLessThanOrEqual(
    after.run.weapons[slot]?.level ?? Number.NaN,
    MAX_WEAPON_LEVEL,
    "Taper's level after the chest, still a base weapon's",
  );
});
