// Wick — spark/fewer-when-fewer: fewer strikes land when fewer enemies are
// within range than the amount.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center, fewer when fewer
//     such enemies exist"; the level-5 row has amount `3`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", `0` with no Mirror held (`specs/passives.md`).
//
// WHAT IS READ. The count of Spark strikes after the firing tick with one
// moth within range and amount `3`: exactly one. A build that lands three
// strikes on the one moth, or none because it cannot fill its amount, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Spark alone at level 5, every
// switch off but `weaponFire`. `enemyMotion` off holds the moth within range
// for the firing tick, and nothing else on the night can create a zone.
//
// TOLERANCE. None: the count is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armSpark, sparkRow, strikesIn, targetsFor } from "./strike";

/** The level whose row has amount 3. */
const LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands exactly one strike at level 5 with one moth within range", async () => {
  assertEqual(sparkRow(LEVEL).amount, 3, "the level-5 row's amount");
  armSpark(h, LEVEL, targetsFor(1));

  const after = await h.tick(1);
  captureStill(h, "fewer");

  assertEqual(
    strikesIn(after).length,
    1,
    "Spark strikes after the firing tick",
  );
});
