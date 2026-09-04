// Wick — spark/distinct-targets: amount `n` lands `n` strikes on `n` distinct
// enemies.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center"; the level-2 row
//     has amount `2`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", `0` with no Mirror held (`specs/passives.md`).
//   - `specs/state.md` (`ZoneState`): a strike's "`x`, `y`" is "the center of
//     the circle", which a strike lands about its target's center, so two
//     strikes on two different enemies have two different centers.
//
// WHAT IS READ. After the firing tick with three moths within range: the
// count of Spark strikes, `2`; each strike centered on one of the three posed
// moths; and the two on different moths. A build that lands one strike, or
// both on the same moth, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths and Spark alone at level 2,
// every switch off but `weaponFire`. `enemyMotion` off holds each moth at its
// posed center, the center a strike is matched against. The moths stand at
// least `250` apart, so a strike on one is centered on no other, and each is
// within `SPARK_RANGE`, so any two of the three are a lawful choice.
//
// TOLERANCE. `FIGURE_TOLERANCE` on a strike's center against a posed center.
// None on the count, a whole number the row states, or on distinctness.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { armSpark, sparkRow, strikesIn, targetOf, targetsFor } from "./strike";

/** The level whose row has amount 2. */
const LEVEL = 2;

/** How many moths stand within range: more than the amount. */
const MOTHS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands two strikes at level 2 on two different of three moths", async () => {
  const amount = sparkRow(LEVEL).amount;
  assertEqual(amount, 2, "the level-2 row's amount");
  const volley = armSpark(h, LEVEL, targetsFor(MOTHS));

  const after = await h.tick(1);
  captureStill(h, "distinct");

  const strikes = strikesIn(after);
  assertEqual(strikes.length, amount, "Spark strikes after the firing tick");
  const first = targetOf(strikes[0], volley.targets, "the first strike");
  const second = targetOf(strikes[1], volley.targets, "the second strike");
  assertNotEqual(second, first, "the second strike's moth against the first's");
});
