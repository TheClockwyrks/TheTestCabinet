// evolutions/recipe-passive-kept — the recipe passive stays held after the
// evolution.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Opening a chest"),
// rule 1: "The evolved weapon replaces its base in the same slot with a single
// level, its cooldown timer is set to `0` ... the passive stays held, and the
// `evolve` cue plays." So the chest that turns Taper into Pyre consumes
// nothing: Wick is still in the passive slot it was in, at the level it was
// held at.
//
// WHY WICK IS HELD AT 3. A build that spent the passive would leave the slot
// empty, and one that spent a LEVEL of it would leave Wick at 2; a level above
// 1 catches both, where level 1 catches only the first. Wick's max is 5
// (`specs/passives.md`), so 3 is a level it can be held at.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at 8 and
// Wick 3 and nothing else, every driver switch off, so the tick that collects
// the chest fires nothing and moves nothing. The evolution itself is
// `evolves-when-eligible`'s point; it is read here only as the precondition
// the passive is examined under, so a build that never evolved fails on that
// line rather than on a passive that was never at risk.
//
// THE TOLERANCE. None: a passive slot's id and level are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openChest,
  passiveSlotOf,
  type Harness,
} from "../harness";
import { holdRecipe } from "./evolved";

/** The Wick level held: above 1, so a level spent is as visible as a slot lost. */
const WICK_LEVEL = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Wick 3 in its passive slot after Taper evolves", async () => {
  isolate(h);
  const slot = holdRecipe(h, "pyre", MAX_WEAPON_LEVEL, WICK_LEVEL);
  const posed = h.snapshot();
  const passiveSlot = passiveSlotOf(posed, "wick");
  assertEqual(
    passiveSlot,
    0,
    "the passive slot Wick took (specs/progression.md, Slots)",
  );

  const after = await openChest(h);
  captureStill(h, "kept");

  assertEqual(
    after.run.weapons[slot]?.id,
    "pyre",
    "the weapon in Taper's slot after the chest (specs/evolutions.md, Opening a chest)",
  );
  assertDeepEqual(
    after.run.passives,
    [{ id: "wick", level: WICK_LEVEL }],
    "the passive slots after the evolution (specs/evolutions.md, Opening a chest)",
  );
});
