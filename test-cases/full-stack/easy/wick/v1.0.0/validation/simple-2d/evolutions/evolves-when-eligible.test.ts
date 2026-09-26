// Wick — evolutions/evolves-when-eligible: a maxed base beside its recipe
// passive evolves on a chest.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("The recipe"): "A base weapon is eligible to
//     evolve when all three hold at once: it is held at `MAX_WEAPON_LEVEL`
//     (`8`); the passive its recipe names is held, at any level; the player
//     opens a chest." The recipe table gives Pyre from Taper with Wick.
//   - `specs/evolutions.md` ("Opening a chest"), rule 1: "the first base weapon
//     at `MAX_WEAPON_LEVEL` whose recipe passive is held at any level evolves
//     ... The evolved weapon replaces its base in the same slot with a single
//     level ... The result is `{ kind: "evolve", weapon }`."
//   - `specs/progression.md` ("Slots"): `MAX_WEAPON_LEVEL` is `8`; ("The chest
//     overlay"): "On the tick it is collected the tick runs to completion, the
//     chest's result is applied ... `chestResult` records it".
//   - `specs/instrumentation.md` (`setScreen`): "The chest overlay is reached
//     through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//     tick, which is the real collection path"; `specs/world.md`
//     ("Collection"): a pickup is collected when it is within
//     `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`) of the
//     lamplighter, which a chest at the center is.
//
// WHAT IS READ. After the collecting tick: the weapon in Taper's slot, which
// reads `pyre` at level `1`; that no slot holds `taper`; and `chestResult`,
// which reads `{ kind: "evolve", weapon: "pyre" }`.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at level 8 in the only weapon slot and
// Wick at level 1 in the only passive slot, nothing on the field, every driver
// switch off, so the chest's result rests on the recipe alone: no other weapon
// can be the first eligible one, no enemy can drop a second chest, and no
// firing, spawn, or hit joins the collecting tick.
//
// TOLERANCE. None: an id, a whole level, and a result object.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { EVOLUTIONS, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  weaponSlot,
  type Harness,
} from "../harness";
import { assertSlotHolds, chestResult, poseChestNight } from "./chest";

/** The evolution this point reaches: Pyre, from Taper with Wick. */
const EVOLUTION = "pyre";

/** Taper, the base the recipe names. */
const BASE = EVOLUTIONS[EVOLUTION].from;

/** Wick, the passive the recipe names. */
const PASSIVE = EVOLUTIONS[EVOLUTION].passive;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Pyre at level 1 in Taper's slot when a chest is collected with Taper at 8 and Wick held", async () => {
  poseChestNight(h);
  const slot = holdWeapon(h, BASE, MAX_WEAPON_LEVEL);
  holdPassive(h, PASSIVE, 1);

  const after = await openChest(h);
  captureStill(h, "evolved");

  assertSlotHolds(after, slot, EVOLUTION, 1, "the slot Taper held");
  assertEqual(
    weaponSlot(after, BASE),
    -1,
    "the slot Taper is held in after the evolution",
  );
  assertDeepEqual(
    chestResult(after, "the chest collected with Taper at 8 and Wick held"),
    { kind: "evolve", weapon: EVOLUTION },
    "the chest's result",
  );
});
