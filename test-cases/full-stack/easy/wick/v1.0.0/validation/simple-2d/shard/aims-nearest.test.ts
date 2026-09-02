// Wick — shard/aims-nearest: the shard leaves the lamplighter's center toward
// the nearest enemy's center, with infinite pierce.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`, fired
//     from the player's center at `speed` toward the nearest enemy, or in the
//     facing direction when no enemy exists ... Its pierce is
//     `INFINITE_PIERCE`", and the level-1 row has speed `500`.
//   - `specs/weapons.md` ("The nearest enemy"): "The nearest enemy is the live
//     enemy whose center is at the smallest distance from the player's center,
//     the lowest `id` breaking a tie", and "A direction toward an enemy is the
//     unit vector from the player's center to the enemy's center". A moth at
//     `(300, 400)` from the center is `500` away, so that unit vector is
//     `(0.6, 0.8)` and the shard's velocity is `500 × (0.6, 0.8)`, which is
//     `(300, 400)`.
//   - `specs/instrumentation.md` (`spawnEnemy`): "A pose that creates an
//     entity gives it the next id from `nextId`", so the moth posed first
//     carries the lower id.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile whose
//     `pierce` is `INFINITE_PIERCE` (`-1`) is never lowered and never removed
//     by a hit".
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick"; phase 6: a new projectile hits "at the position it was
//     created at and first moving on the next tick", so after the firing tick
//     the shard sits at the lamplighter's center with its launch velocity.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick".
//
// WHAT IS READ. Every Shard projectile after the firing tick: its center
// against the lamplighter's, its velocity against `(300, 400)`, and its pierce
// against `-1`. Both velocity components are asserted, so a build that aims
// along an axis, along the facing direction while an enemy is alive, at the
// enemy's edge, or from somewhere other than the center fails.
//
// WHY TWO MOTHS. With one enemy alive, every rule for choosing among enemies
// has the same answer, so a build that aims at the FARTHEST enemy or at the
// LOWEST-ID one reads as conformant. Two are posed: the far moth at
// `(-600, 0)`, 600 units out, spawned FIRST so it carries the lower id, and
// the near moth at `(300, 400)`, 500 units out. The asserted velocity is
// toward the near one, so a build ordering by id and a build taking the
// farthest both fail, and the reading still traces only to the figures the
// specification states.
//
// WHY THE NIGHT IS POSED AS IT IS. Two moths and Shard alone at level 1, every
// switch off but `weaponFire`. `enemyMotion` off holds each moth where it was
// posed for the firing tick; `effectMotion` off holds the shard at its launch
// for the reading, as phase 6 would anyway before its first move. The nearer
// moth is `500` units out and the farther `600`, so the shard created at the
// center overlaps neither and is still in `projectiles` to read.
//
// TOLERANCE. `MOTION_TOLERANCE` on the shard's center against the
// lamplighter's, a position read back; `FIGURE_TOLERANCE` on each velocity
// component, the product of the stated speed and a quotient of stated figures.
// None on pierce, a whole number the spec states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  MOTION_TOLERANCE,
} from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import { armShard, shardRow } from "./volley";

/** The nearer moth, 500 units from the lamplighter's center. */
const MOTH = { x: 300, y: 400 };

/**
 * The farther moth, 600 units out along `-x`. Posed first, so it holds the
 * lower id and a build ordering by id aims at it rather than at {@link MOTH}.
 */
const FARTHER = { x: -600, y: 0 };

/** The unit vector toward it, `(300, 400) / 500`. */
const DIRECTION = { x: 0.6, y: 0.8 };

/** The level-1 row's speed times that direction: `(300, 400)`. */
const EXPECTED = {
  vx: shardRow(1).speed * DIRECTION.x,
  vy: shardRow(1).speed * DIRECTION.y,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the shard at the lamplighter's center with velocity 500 × (0.6, 0.8) and pierce -1", async () => {
  const volley = armShard(h, 1, [FARTHER, MOTH]);

  const after = await h.tick(1);
  captureStill(h, "aimed");

  const shards = projectilesOf(after, "shard");
  assertGreaterThan(
    shards.length,
    0,
    "Shard projectiles after the firing tick",
  );
  for (const shard of shards) {
    assertWithin(
      shard.x,
      volley.player.x,
      MOTION_TOLERANCE,
      `shard ${shard.id}: x of its center`,
    );
    assertWithin(
      shard.y,
      volley.player.y,
      MOTION_TOLERANCE,
      `shard ${shard.id}: y of its center`,
    );
    assertWithin(
      shard.vx,
      EXPECTED.vx,
      FIGURE_TOLERANCE,
      `shard ${shard.id}: vx`,
    );
    assertWithin(
      shard.vy,
      EXPECTED.vy,
      FIGURE_TOLERANCE,
      `shard ${shard.id}: vy`,
    );
    assertEqual(shard.pierce, INFINITE_PIERCE, `shard ${shard.id}: pierce`);
  }
});
