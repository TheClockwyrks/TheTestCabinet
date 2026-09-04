// Wick — weapons/finite-pierce-ascending-id: a finite-pierce projectile
// overlapping several enemies on one tick hits them in ascending id until it
// is removed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "When one such projectile
//     overlaps several enemies on the same tick, they are hit in ascending
//     enemy `id` until the projectile is removed", and a projectile with
//     pierce `n` "hits `n + 1` enemies".
//   - `specs/enemies.md` ("The life of an enemy"): "ids ascend in spawn
//     order", and `specs/instrumentation.md`: a posed enemy "takes the next
//     id".
//   - `specs/weapons.md` ("Pin"): level-1 damage `6`, radius `6`;
//     `specs/enemies.md`: a moth has HP `5`, radius `10`, so every hit kills
//     and a moth within 16 units of the dart's center overlaps it.
//
// WHAT IS READ. After the one tick on which a posed pierce-1 pin overlaps
// three moths: the two with the lowest ids are gone and the third still stands
// with its hp untouched. The ids are spawned AGAINST the geometry: the highest
// id is the moth on the pin's exact center and the lowest is farthest along
// +x, so a build that hits by distance, by array position after some sort, or
// by proximity to the lamplighter spends the pin on the wrong pair.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths and the pin alone, 150 units
// from the lamplighter, every switch off: nothing moves, so the overlap the
// tick reads is the posed one, and nothing else can touch the third moth's hp.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the untouched moth's hp, which is its
// spawn value copied through; none on presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, PIN_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The pierce the pin is posed with: two hits, the second removing it. */
const PIERCE = 1;

/** Where the pin's center stands: along +x, clear of the lamplighter. */
const DX = 150;

/**
 * The moths' offsets from the pin's center along x, in SPAWN order: the
 * lowest id farthest out, the highest on the center, each inside the 16 the
 * radii sum to.
 */
const ROW_OFFSETS = [10, -10, 0] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the two lowest-id moths of three and leaves the third untouched", async () => {
  for (const offset of ROW_OFFSETS) {
    assertEqual(
      Math.abs(offset) < PIN_LEVELS[0].radius + ENEMIES.moth.radius,
      true,
      `offset ${offset} is inside the dart's overlap with a moth`,
    );
  }
  isolate(h);
  const moths = ROW_OFFSETS.map((offset) =>
    spawnEnemyNear(h, "moth", DX + offset, 0),
  );
  const center = present(
    enemyById(h.snapshot(), moths[2]),
    "the moth on the pin's center",
  );
  spawnProjectileAt(h, "pin", center.x, center.y, 0, 0, PIERCE);

  const after = await h.tick(1);
  captureStill(h, "order");

  assertEqual(enemyById(after, moths[0]), undefined, "the lowest-id moth");
  assertEqual(enemyById(after, moths[1]), undefined, "the middle-id moth");
  const spared = present(enemyById(after, moths[2]), "the highest-id moth");
  assertWithin(
    spared.hp,
    center.hp,
    FIGURE_TOLERANCE,
    "the highest-id moth's hp after the tick",
  );
});
