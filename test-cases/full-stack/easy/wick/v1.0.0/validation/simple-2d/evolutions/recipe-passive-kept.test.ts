// Wick — evolutions/recipe-passive-kept: the recipe passive stays held after
// the evolution, at its level.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Opening a chest"), rule 1: "The evolved weapon
//     replaces its base in the same slot with a single level, its cooldown
//     timer is set to `0` ..., the passive stays held, and the `evolve` cue
//     plays."
//   - `specs/progression.md` ("Slots"): "An item enters the first free slot of
//     its kind at level `1` and keeps that slot for the rest of the run", so
//     the passive's slot is the one it was posed in.
//   - `specs/passives.md`: Wick's `maxLevel` is `5`, so level `3` is a level
//     Wick can be held at, and one the evolution must neither raise nor lower.
//
// WHAT IS READ. After the collecting tick: the passive slot Wick was posed in
// still holds `wick`, at level `3`, and the evolution did happen, which is what
// makes the reading about the evolution rather than about a chest that did
// nothing.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper at level 8 and Wick alone in the
// passive slots at level 3, so the recipe fires and the passive read back is
// the one the recipe consumed; Wick above level 1, so a build that re-created
// the passive at level 1 rather than keeping it fails; nothing on the field and
// every driver switch off.
//
// TOLERANCE. None: an id and a whole level.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EVOLUTIONS, MAX_WEAPON_LEVEL, PASSIVES } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  openChest,
  type Harness,
} from "../harness";
import { assertResultKind, poseChestNight } from "./chest";

/** The evolution this point reaches: Pyre, from Taper with Wick. */
const EVOLUTION = "pyre";
const PASSIVE = EVOLUTIONS[EVOLUTION].passive;

/** The level Wick is held at: above 1, and within its maxLevel of 5. */
const PASSIVE_LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Wick in its slot at level 3 after Taper evolves", async () => {
  assertEqual(
    PASSIVE_LEVEL <= PASSIVES[PASSIVE].maxLevel,
    true,
    "the posed Wick level against its maxLevel",
  );
  poseChestNight(h);
  holdWeapon(h, EVOLUTIONS[EVOLUTION].from, MAX_WEAPON_LEVEL);
  const slot = holdPassive(h, PASSIVE, PASSIVE_LEVEL);

  const after = await openChest(h);
  captureStill(h, "kept");

  assertResultKind(after, "evolve", "the chest that evolved Taper");
  assertEqual(
    after.run.passives[slot]?.id,
    PASSIVE,
    "the passive in the slot Wick was posed in",
  );
  assertEqual(
    after.run.passives[slot]?.level,
    PASSIVE_LEVEL,
    "Wick's level after the evolution",
  );
});
