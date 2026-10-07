// Wick — evolutions/beacon-amount-bonus: Beacon's amount takes `amountBonus`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Passives still apply"): "amount is the fixed
//     amount plus `amountBonus`"; ("Beacon") the fixed row has amount `1`, and
//     "With amount `n`, `n` bolts fire on the same tick at the `n` nearest
//     distinct enemies, fewer when fewer exist."
//   - `specs/passives.md` ("Amount"): "The weapons whose stat row carries an
//     `amount` all take the bonus, Beacon, Hail, Chandelier, and Blaze
//     included", and `amountBonus` is `MIRROR_AMOUNT_PER_LEVEL` (`1`) per
//     Mirror level, so Mirror at level 1 gives an amount of 2.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy is
//     the unit vector from the player's center to the enemy's center", which is
//     what tells one bolt's target from the other's.
//   - `specs/world.md` ("One tick"), phase 6: a new projectile is "first moving
//     on the next tick", so after the firing tick each bolt still carries its
//     launch velocity.
//
// WHAT IS READ. After the firing tick with Mirror 1 held and two moths in two
// directions: exactly two Beacon bolts, and for each moth exactly one bolt
// aimed along the direction to it. A build that ignores the bonus fires one
// bolt, and one that fires both at the same moth leaves the other unaimed at.
//
// WHY THE NIGHT IS POSED AS IT IS. Beacon alone with Mirror at level 1 the only
// passive, so the amount is the only figure the passive moves; two moths, as
// many as the amount, so the count read is the amount's own and not a shortfall
// of targets; both at 200 units in different directions, so no bolt created at
// the lamplighter's center overlaps one on the firing tick and each bolt's
// target is told by direction alone; every driver switch but `weaponFire` off.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of a bolt's unit velocity
// against a direction whose components are quotients of stated figures. None on
// the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  BEACON_STATS,
  DIRECTION_TOLERANCE,
  MIRROR_AMOUNT_PER_LEVEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  projectilesOf,
  spawnEnemyNear,
  unit,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** The Mirror level held: one bolt more than the fixed amount. */
const MIRROR_LEVEL = 1;

/** The amount the firing tick reads: 1 + 1. */
const AMOUNT = BEACON_STATS.amount + MIRROR_AMOUNT_PER_LEVEL * MIRROR_LEVEL;

/** Two moths, equally far in two directions. */
const MOTHS = [
  { dx: 200, dy: 0 },
  { dx: 0, dy: 200 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires two bolts with Mirror 1 held, one aimed at each of two moths", async () => {
  const { player } = armEvolved(h, "beacon");
  holdPassive(h, "mirror", MIRROR_LEVEL);
  for (const moth of MOTHS) spawnEnemyNear(h, "moth", moth.dx, moth.dy);

  const after = await h.tick(1);
  captureStill(h, "two");

  const bolts = projectilesOf(after, "beacon");
  assertEqual(bolts.length, AMOUNT, "Beacon bolts after the firing tick");
  MOTHS.forEach((moth, index) => {
    const toward = unit(moth.dx, moth.dy);
    const aimed = bolts.filter((bolt) => {
      const heading = unit(bolt.vx, bolt.vy);
      return (
        Math.abs(heading.x - toward.x) <= DIRECTION_TOLERANCE &&
        Math.abs(heading.y - toward.y) <= DIRECTION_TOLERANCE
      );
    });
    assertEqual(
      aimed.length,
      1,
      `bolts aimed at the moth at (${player.x + moth.dx}, ${player.y + moth.dy}), moth ${index + 1}`,
    );
  });
});
