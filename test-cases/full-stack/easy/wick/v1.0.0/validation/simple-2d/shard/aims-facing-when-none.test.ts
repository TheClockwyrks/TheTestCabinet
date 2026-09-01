// Wick — shard/aims-facing-when-none: with no enemy alive, the shard leaves
// along the facing direction.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`, fired
//     from the player's center at `speed` toward the nearest enemy, or in the
//     facing direction when no enemy exists, so Shard fires whether or not any
//     enemy exists", and the level-1 row has speed `500`.
//   - `specs/weapons.md` ("The nearest enemy"): "The facing direction is
//     `facing` from `specs/world.md`: `+x` for `"right"` and `-x` for
//     `"left"`", so with `facing` `"left"` the shard's velocity is
//     `500 × (-1, 0)`, which is `(-500, 0)`.
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick"; phase 6: a new projectile hits "at the position it was
//     created at and first moving on the next tick", so after the firing tick
//     the shard sits at the lamplighter's center with its launch velocity.
//   - `specs/instrumentation.md` (`setFacing`): "Sets `facing`"; "Every
//     cooldown timer holds where it stands and nothing fires" only while
//     `weaponFire` is off, so with it on and the timer at `0` the next tick
//     fires.
//
// WHAT IS READ. That at least one Shard projectile exists after the firing
// tick with no enemy alive, and every one's center against the lamplighter's
// and velocity against `(-500, 0)`. Facing is posed LEFT rather than left at
// the fresh run's `"right"`, so a build that falls back to a fixed `+x`, to a
// zero vector, or that does not fire at all without an enemy fails.
//
// WHY THE NIGHT IS POSED AS IT IS. No enemy and Shard alone at level 1, every
// switch off but `weaponFire`, `facing` posed `"left"`. `effectMotion` off
// holds the shard at its launch for the reading, as phase 6 would anyway
// before its first move; a few ticks of `effectMotion` run AFTER the reading,
// for the still alone, so the picture shows where the shard went. Nothing
// there reaches the assertions.
//
// TOLERANCE. `MOTION_TOLERANCE` on the shard's center against the
// lamplighter's, a position read back; `FIGURE_TOLERANCE` on each velocity
// component, the stated speed along an exact axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  projectilesOf,
  type Harness,
} from "../harness";
import { armShard, shardRow } from "./volley";

/** The facing direction posed, and the axis the shard must leave along. */
const FACING = "left";
const DIRECTION = { x: -1, y: 0 };

/** The level-1 row's speed along it: `(-500, 0)`. */
const EXPECTED = {
  vx: shardRow(1).speed * DIRECTION.x,
  vy: shardRow(1).speed * DIRECTION.y,
};

/** Ticks of `effectMotion` run after the reading, for the still alone. */
const FLIGHT_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the shard at the lamplighter's center with velocity (-500, 0) while facing left with no enemy", async () => {
  const volley = armShard(h, 1, []);
  h.debug.setFacing(FACING);
  const posed = h.snapshot();
  assertEqual(posed.run.player.facing, FACING, "facing before the tick");
  assertEqual(posed.run.enemies.length, 0, "enemies alive before the tick");

  const after = await h.tick(1);
  enable(h, "effectMotion");
  await h.tick(FLIGHT_TICKS);
  captureStill(h, "facing");

  const shards = projectilesOf(after, "shard");
  assertGreaterThan(
    shards.length,
    0,
    "Shard projectiles after the firing tick with no enemy alive",
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
  }
});
