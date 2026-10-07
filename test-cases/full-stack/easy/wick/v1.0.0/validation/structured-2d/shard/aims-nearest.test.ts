// shard/aims-nearest — the shard leaves toward the nearest enemy's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "A shard is a
// circle of `radius`, fired from the player's center at `speed` toward the
// nearest enemy, or in the facing direction when no enemy exists ... Its
// pierce is `INFINITE_PIERCE`." Level 1's row gives `speed` 500. And ("The
// nearest enemy"): "A direction toward an enemy is the unit vector from the
// player's center to the enemy's center". So with one moth at `(300, 400)`
// from a lamplighter at the origin, 500 units out, the unit vector is
// `(0.6, 0.8)` and the shard's velocity is `500 × (0.6, 0.8) = (300, 400)`,
// leaving from `(0, 0)`.
//
// WHY THE SHARD IS READ AT THE PLAYER'S CENTER. `specs/world.md` ("One tick"),
// phase 6: a new projectile hits "at the position it was created at and first
// moving on the next tick", so after the firing tick the shard still sits
// where it was fired from. The lamplighter holds no key, so its center is
// where the run began.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at
// `TARGET_POST`, Shard at level 1 armed, `weaponFire` on and every other
// switch off: the moth neither moves nor touches the lamplighter, no other
// weapon fires, and level 1's amount of 1 makes one shard on the tick. That
// the level-1 row carries amount 1 and pierce -1 is `row-1`'s point; here the
// one enemy is the nearest and the aim is what is read.
//
// THE TOLERANCE. `REAL_EPS` on the start, which is a copy of the player's
// center, and `MOTION_EPS` on each velocity component, a stated speed times a
// unit vector each rounded by an ulp or two; a shard aimed along an axis, at
// the moth's edge, or along the facing direction while an enemy is alive is
// off by units. The pierce is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertPointNear } from "../assert";
import {
  INFINITE_PIERCE,
  MOTION_EPS,
  REAL_EPS,
  SHARD_LEVELS,
} from "../constants";
import { captureStill, createHarness, unit, type Harness } from "../harness";
import { fireShard, TARGET_POST } from "./firing";

/** Level 1 of Shard: amount 1, speed 500. */
const LEVEL = 1;
const ROW = SHARD_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the shard from the lamplighter's center at 500 along (0.6, 0.8) with pierce -1", async () => {
  const firing = await fireShard(h, LEVEL, [TARGET_POST]);
  captureStill(h, "aimed");

  assertEqual(firing.shards.length, 1, "the shards the firing tick created");
  const shard = firing.shards[0];
  assertPointNear(
    shard,
    firing.after.run.player,
    REAL_EPS,
    "the shard's center on the firing tick, against the player's center",
  );
  const toward = unit(TARGET_POST.x, TARGET_POST.y);
  assertNear(
    shard.vx,
    ROW.speed * toward.x,
    MOTION_EPS,
    "the shard's vx, against 500 × 0.6",
  );
  assertNear(
    shard.vy,
    ROW.speed * toward.y,
    MOTION_EPS,
    "the shard's vy, against 500 × 0.8",
  );
  assertEqual(shard.pierce, INFINITE_PIERCE, "the shard's pierce");
});
