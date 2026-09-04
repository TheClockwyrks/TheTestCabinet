// Wick — ember/amount-fires-distinct-nearest: amount `n` fires `n` bolts on
// one tick, one at each of the `n` nearest distinct enemies.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"): "With amount `n`, `n` bolts fire on the
//     same tick, one at each of the `n` nearest distinct enemies", and the
//     level-2 row has amount `2`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", `0` with no Mirror held (`specs/passives.md`).
//   - `specs/weapons.md` ("The nearest enemy"): "The `n` nearest enemies are
//     the first `n` in that same ordering, distance then `id`", and "A
//     direction toward an enemy is the unit vector from the player's center
//     to the enemy's center".
//   - `specs/world.md` ("One tick"), phase 6: a new bolt is "first moving on
//     the next tick", so after the firing tick every bolt still carries its
//     launch velocity.
//
// WHAT IS READ. The Ember bolts after the firing tick, with three moths at
// `100`, `200`, and `300` units in three directions: there are exactly two,
// and for each of the two nearer moths exactly one bolt is aimed along the
// direction to it. A build that fires one bolt, fires both at the nearest,
// or aims one at the farthest fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths and Ember alone at level 2,
// every switch off but `weaponFire`. `enemyMotion` off holds the moths at the
// three distances the ordering is read from; `effectMotion` off holds each
// bolt at its launch for the reading. The nearest moth is `100` units out, so
// no bolt created at the center overlaps any moth on the firing tick, and
// every bolt is still in `projectiles` to read.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of a bolt's unit
// velocity against a direction whose components are quotients of stated
// figures. None on the count, a whole number the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armEmber, boltsAimedAt, emberRow } from "./volley";

/** The level whose row has amount 2. */
const LEVEL = 2;

/** Three moths at 100, 200, and 300 units, each in its own direction. */
const MOTHS = [
  { x: 100, y: 0 },
  { x: 0, y: 200 },
  { x: -300, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires two bolts at level 2, one at each of the two nearer of three moths", async () => {
  const volley = armEmber(h, LEVEL, MOTHS);
  const amount = emberRow(LEVEL).amount;
  assertEqual(amount, 2, "the level-2 row's amount");

  const after = await h.tick(1);
  captureStill(h, "two");

  const bolts = projectilesOf(after, "ember");
  assertEqual(bolts.length, amount, "Ember bolts after the firing tick");
  const nearer = volley.targets.slice(0, amount);
  nearer.forEach((moth, rank) => {
    assertEqual(
      boltsAimedAt(volley, bolts, moth).length,
      1,
      `bolts aimed at the moth ranked ${rank + 1} by distance`,
    );
  });
});
