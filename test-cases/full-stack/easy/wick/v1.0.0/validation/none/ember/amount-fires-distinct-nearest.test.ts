// Wick — ember/amount-fires-distinct-nearest: amount `n` fires `n` bolts on one
// tick, one at each of the `n` nearest distinct enemies.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "With amount
// `n`, `n` bolts fire on the same tick, one at each of the `n` nearest
// distinct enemies"; ("The nearest enemy"): "The `n` nearest enemies are the
// first `n` in that same ordering, distance then `id`", and "A direction
// toward an enemy is the unit vector from the player's center to the enemy's
// center". Row 2 of `EMBER_LEVELS` gives amount `2`, and with no Lure held
// `amountBonus` is `0` (`specs/passives.md`). So with three moths at `100`,
// `200`, and `300` from the lamplighter, the firing tick creates two bolts,
// one aimed at the moth at `100` and one at the moth at `200`, and none at the
// moth at `300`.
//
// THE POSE. An isolated night with the lamplighter at the origin and three
// moths on three distinct directions, `100`, `200`, and `300` out, then Ember
// held at level 2 and fired through the shared `fireWeapon`. `enemyMotion` is
// held so the moths stand where they were posed on the firing tick, and
// `effectMotion` is held so each bolt stands at the center with the velocity
// the firing gave it. The nearest moth is `100` from the bolts' center against
// a sum of radii of `18`, so nothing is hit on the firing tick. The three
// directions are `90` degrees apart, so a bolt aimed at one moth is nowhere
// near the direction to another.
//
// TOLERANCE. `FLOAT_TOL` on each component of a bolt's unit direction against
// the direction toward its target; the bolt count is exact, and which bolt id
// went to which target is left to the build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { EMBER, assertOneBoltPerTarget, boltsOf, placeMoths } from "./stage";

/** The level whose row carries amount `2`. */
const LEVEL = 2;

/** The nearer two moths, `100` and `200` out on distinct directions. */
const NEARER = [
  { x: 100, y: 0 },
  { x: 0, y: 200 },
];

/** The farthest moth, `300` out, which no bolt is aimed at. */
const FARTHEST = { x: -300, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires two Ember bolts at level 2, one at each of the two nearer of three moths", async () => {
  assertEqual(weaponRow(EMBER, LEVEL).amount, NEARER.length, "row 2's amount");
  await isolate(h);
  await placeMoths(h, [...NEARER, FARTHEST]);

  const firing = await fireWeapon(h, EMBER, LEVEL);
  await captureStill(h, "two");

  assertOneBoltPerTarget(
    firing.before,
    boltsOf(firing),
    NEARER,
    "the level-2 firing over three moths",
  );
});
