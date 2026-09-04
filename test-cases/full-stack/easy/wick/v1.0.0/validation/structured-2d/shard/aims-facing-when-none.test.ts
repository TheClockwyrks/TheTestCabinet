// shard/aims-facing-when-none — with no enemy alive the shard leaves along the
// facing direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "A shard is a
// circle of `radius`, fired from the player's center at `speed` toward the
// nearest enemy, or in the facing direction when no enemy exists, so Shard
// fires whether or not any enemy exists." Level 1's row gives `speed` 500. And
// ("The nearest enemy"): "The facing direction is `facing` from
// `specs/world.md`: `+x` for `"right"` and `-x` for `"left"`". So with `facing`
// posed `"left"` and nothing alive, the shard's velocity is
// `500 × (-1, 0) = (-500, 0)`, leaving from the player's center.
//
// WHY FACING IS POSED LEFT. A fresh run starts facing `"right"`
// (`specs/world.md`, Facing), so a build that ignores `facing` and always
// fires along `+x` would pass a check posed to the right. The pose is read
// back off the snapshot before the firing tick, so a surface whose `setFacing`
// does nothing fails here rather than on the direction the shard flew.
//
// WHY THE SHARD IS READ AT THE PLAYER'S CENTER. `specs/world.md` ("One tick"),
// phase 6: a new projectile hits "at the position it was created at and first
// moving on the next tick", so after the firing tick the shard still sits
// where it was fired from.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy at all, Shard
// at level 1 armed, `weaponFire` on and every other switch off. A build that
// does not fire without a target creates no shard and fails; one that falls
// back to `+x`, or to a zero velocity, fails on the velocity.
//
// THE TOLERANCE. `REAL_EPS` on the start, which is a copy of the player's
// center, and on each velocity component, the stated speed along an exact
// axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertPointNear } from "../assert";
import { REAL_EPS, SHARD_LEVELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireShard } from "./firing";

/** Level 1 of Shard: amount 1, speed 500. */
const LEVEL = 1;
const ROW = SHARD_LEVELS[LEVEL - 1];

/** The facing posed, and the axis it names: `-x` for `"left"`. */
const FACING = "left";
const DIRECTION = { x: -1, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the shard at 500 along (-1, 0) while facing left with nothing alive", async () => {
  const firing = await fireShard(h, LEVEL, [], { facing: FACING });
  captureStill(h, "facing");

  assertEqual(
    firing.before.run.player.facing,
    FACING,
    "the facing posed before the firing (specs/instrumentation.md, setFacing)",
  );
  assertEqual(
    firing.before.run.enemies.length,
    0,
    "the enemies alive before the firing (specs/weapons.md, Shard)",
  );
  assertEqual(firing.shards.length, 1, "the shards the firing tick created");
  const shard = firing.shards[0];
  assertPointNear(
    shard,
    firing.after.run.player,
    REAL_EPS,
    "the shard's center on the firing tick, against the player's center",
  );
  assertNear(
    shard.vx,
    ROW.speed * DIRECTION.x,
    REAL_EPS,
    "the shard's vx, against 500 × -1",
  );
  assertNear(
    shard.vy,
    ROW.speed * DIRECTION.y,
    REAL_EPS,
    "the shard's vy, against 500 × 0",
  );
});
