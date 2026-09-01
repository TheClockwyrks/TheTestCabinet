// Wick — oil-splash/pulses-on-appearance: a puddle pulses on the tick it
// appears.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "A puddle is a pulsing effect with
//     interval `OIL_PULSE` (`0.3`): it pulses on the tick it appears and on
//     every `OIL_PULSE` interval of ticks after, and each pulse deals `damage`
//     to every enemy overlapping it."
//   - `specs/weapons.md` ("Oil Splash"), row 1: "| 1 | 4 | 3.0 | 50 | 2.5 |
//     1 |", damage 4 and radius 50.
//   - `specs/world.md` ("One tick"), phase 6: "every projectile and zone hits,
//     this tick's new ones included, a new one hitting at the position it was
//     created at".
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii",
//     and ("Hits and death"): "A hit removes the shape's damage per hit from
//     the enemy's `hp`". A moth's radius is 10 and its health 5
//     (`specs/enemies.md`).
//
// WHAT IS READ. Every moth whose center is less than 60 from the puddle's
// center after the firing tick, and each one's `hp`: lower than before the
// tick by 4, the level-1 damage, so the landing pulse hit it. A build whose
// first pulse waits an interval, or that only pulses from the tick after,
// leaves every such moth at its posed health.
//
// WHY THE NIGHT IS POSED AS IT IS. The landing point is a random draw the
// build orders as it likes, so no moth can be stood on it ahead of the firing;
// instead a lattice of moths 80 apart covers the scatter disk, so wherever the
// one level-1 puddle lands at least one moth overlaps it (the reasoning is in
// `puddle.ts`). Oil Splash alone at level 1, so exactly one puddle appears and
// no moth is hit twice on the tick; every switch but `weaponFire` is off, so
// the moths stand still and none touches the lamplighter; no passive is held,
// so a moth's health is the table's 5 and the pulse takes it to 1, not to
// death.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the health drop, a stated figure
// read back; and a moth within that of the overlap boundary is left out of
// the reading, the boundary being the overlap point's own. None on the count
// of puddles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin, fail } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  present,
  type Harness,
} from "../harness";
import {
  armOilSplash,
  oilRow,
  overlapsPuddle,
  poseMothLattice,
  puddlesOf,
} from "./puddle";

/** The level held: one puddle of radius 50 and damage 4. */
const LEVEL = 1;
const ROW = oilRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages every moth overlapping the puddle on the tick it appears", async () => {
  const { player } = armOilSplash(h, LEVEL);
  const moths = poseMothLattice(h, player);
  const posed = h.snapshot();

  const after = await h.tick(1);
  captureStill(h, "first");

  const puddles = puddlesOf(after);
  assertEqual(puddles.length, 1, "Oil Splash puddles after the firing tick");
  const puddle = puddles[0];
  const center = { x: puddle.x, y: puddle.y };
  const overlapping = moths.filter((moth) =>
    overlapsPuddle(moth.at, center, ROW.radius),
  );
  assertGreaterThan(
    overlapping.length,
    0,
    `moths overlapping the puddle at (${puddle.x}, ${puddle.y})`,
  );
  for (const moth of overlapping) {
    const before = present(
      enemyById(posed, moth.id),
      `moth ${moth.id} before the firing tick`,
    );
    const hit = enemyById(after, moth.id);
    if (hit === undefined) {
      fail(
        `moth ${moth.id} at (${moth.at.x}, ${moth.at.y}) standing with ${ROW.damage} removed from its ${before.hp} health by the landing pulse`,
        "gone from the field on the firing tick",
      );
    }
    assertWithin(
      before.hp - hit.hp,
      ROW.damage,
      FIGURE_TOLERANCE,
      `moth ${moth.id} at (${moth.at.x}, ${moth.at.y}): health removed on the firing tick`,
    );
  }
});
