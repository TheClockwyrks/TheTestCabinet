// Wick — ember/fewer-when-fewer: fewer bolts fire when fewer enemies exist
// than the amount.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"): "With amount `n`, `n` bolts fire on the
//     same tick, one at each of the `n` nearest distinct enemies, fewer when
//     fewer enemies exist", and the level-6 row has amount `3`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", `0` with no Mirror held (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 6: a new bolt is "first moving on
//     the next tick", so a bolt created at the center is still in
//     `projectiles` after the firing tick.
//
// WHAT IS READ. The count of Ember bolts after the firing tick with one moth
// alive and amount `3`: exactly one. A build that fires three bolts at the one
// moth, or none because it cannot fill its amount, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Ember alone at level 6, every
// switch off but `weaponFire`. `enemyMotion` off holds the moth where it was
// posed; `effectMotion` off holds the bolt at its launch. The moth is `150`
// units out, so the bolt created at the center overlaps nothing on the firing
// tick.
//
// TOLERANCE. None: the count is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEmber, emberRow, targetsFor } from "./volley";

/** The level whose row has amount 3. */
const LEVEL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires exactly one bolt at level 6 with one moth alive", async () => {
  armEmber(h, LEVEL, targetsFor(1));
  assertEqual(emberRow(LEVEL).amount, 3, "the level-6 row's amount");

  const after = await h.tick(1);
  captureStill(h, "fewer");

  assertEqual(
    projectilesOf(after, "ember").length,
    1,
    "Ember bolts after the firing tick",
  );
});
