// Wick — shard/aims-facing-when-none: with no enemy alive the shard flies in
// the facing direction.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "A shard is a
// circle of `radius`, fired from the player's center at `speed` toward the
// nearest enemy, or in the facing direction when no enemy exists, so Shard
// fires whether or not any enemy exists"; ("The nearest enemy"): "The facing
// direction is `facing` from `specs/world.md`: `+x` for `"right"` and `-x`
// for `"left"`." Row 1 of `SHARD_LEVELS` gives speed `500` and amount `1`. So
// with no enemy alive and `facing` `"left"`, the firing tick creates one shard
// with velocity `(-500, 0)`.
//
// THE POSE. An isolated night, so nothing is alive, with `setFacing("left")`
// posed and read back, then Shard held at level 1 and fired through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). Facing left rather than
// the `"right"` a run starts with, so a build that ignores `facing` and fires
// along `+x` reads two units of direction away. `effectMotion` is held so the
// shard stands at the center with the velocity the firing gave it, and nothing
// is there for it to hit.
//
// TOLERANCE. `FLOAT_TOL` on the components of the shard's velocity, a speed
// times a unit vector that is exact along an axis; the wrong facing is `1000`
// units of velocity away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  facingVector,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { SHARD, shardsOf } from "./stage";

/** The level whose row is fired: one shard at `500` units per second. */
const LEVEL = 1;

/** Shard's level-1 speed, `500`. */
const SPEED = weaponRow(SHARD, LEVEL).speed!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires a shard at (-500, 0) with no enemy alive and the lamplighter facing left", async () => {
  await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(posed.run.player.facing, "left", "the facing posed");
  assertEqual(
    (posed.run.enemies ?? []).length,
    0,
    "enemies alive on the firing tick",
  );

  const firing = await fireWeapon(h, SHARD, LEVEL);
  await captureStill(h, "facing");

  const shards = shardsOf(firing);
  assertEqual(
    shards.length,
    1,
    "Shard projectiles the firing tick created at level 1",
  );
  const shard = shards[0]!;
  const wanted = facingVector("left");
  assertNear(shard.vx, SPEED * wanted.x, FLOAT_TOL, "the shard's velocity, x");
  assertNear(shard.vy, SPEED * wanted.y, FLOAT_TOL, "the shard's velocity, y");
});
