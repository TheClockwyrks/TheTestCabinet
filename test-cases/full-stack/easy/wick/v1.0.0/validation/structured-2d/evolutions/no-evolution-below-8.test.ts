// evolutions/no-evolution-below-8 — a base below MAX_WEAPON_LEVEL does not
// evolve.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("The recipe"): "A
// base weapon is eligible to evolve when all three hold at once: it is held at
// `MAX_WEAPON_LEVEL` (`8`); the passive its recipe names is held, at any
// level; the player opens a chest." Taper at level 7 fails the first
// condition, so rule 1 of ("Opening a chest") finds nothing to evolve and the
// result falls to rule 2: "One held item below its max level ... is chosen
// uniformly at random ... The result is `{ kind: "level", item, level }`."
// Taper at 7 and Wick at 1 are both below their maxes, so the pool is never
// empty and the heal of rule 3 is out of reach.
//
// WHAT IS ASSERTED, AND IN WHICH DIRECTION. That the chest did NOT evolve: no
// slot holds Pyre, Taper is still held as a base weapon, and the result is a
// level rather than an evolve. WHICH of the two items the chest levelled is
// drawn "uniformly at random", so this check
// reads neither the item nor its new level — a chest that levels Taper from 7
// to 8 is as conformant as one that levels Wick, and `chest-fallback-level`
// is where the level result itself is graded.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Taper
// at 7 and Wick 1, every driver switch off, so the tick that collects the
// chest fires nothing, spawns nothing and moves nothing. Level 7 is the
// nearest level to `MAX_WEAPON_LEVEL` that is still below it, so a build whose
// eligibility test is off by one fails here.
//
// THE TOLERANCE. None: a slot's id and a result's kind are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertUndefined } from "../assert";
import { MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  heldWeapon,
  isolate,
  openChest,
  type Harness,
} from "../harness";
import { chestResultOf, holdRecipe } from "./evolved";

/** One below `MAX_WEAPON_LEVEL`: eligible on every count but the level. */
const LEVEL = MAX_WEAPON_LEVEL - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves Taper a base weapon and reports a level result with Taper at 7", async () => {
  isolate(h);
  holdRecipe(h, "pyre", LEVEL);
  assertEqual(
    heldWeapon(h.snapshot(), "taper")?.level,
    LEVEL,
    "Taper's level before the chest (specs/instrumentation.md, setWeapon)",
  );

  const after = await openChest(h);
  captureStill(h, "held");

  assertUndefined(
    heldWeapon(after, "pyre"),
    `the slot holding Pyre after a chest with Taper at ${LEVEL} (specs/evolutions.md, The recipe)`,
  );
  assertDefined(
    heldWeapon(after, "taper"),
    "the slot holding Taper after the chest (specs/evolutions.md, The recipe)",
  );
  assertEqual(
    chestResultOf(after).kind,
    "level",
    `the chest's result with Taper at ${LEVEL} and Wick 1 held, both below their maxes (specs/evolutions.md, Opening a chest)`,
  );
});
