// Wick — shard/aims-nearest: the shard leaves the lamplighter's center toward
// the nearest enemy's center.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "A shard is a
// circle of `radius`, fired from the player's center at `speed` toward the
// nearest enemy ... Its pierce is `INFINITE_PIERCE`"; ("The nearest enemy"):
// "A direction toward an enemy is the unit vector from the player's center to
// the enemy's center". Row 1 of `SHARD_LEVELS` gives speed `500` and amount
// `1`, and `INFINITE_PIERCE` is `-1`. So with the lamplighter at the origin
// and one moth at `(300, 400)`, `500` units out, the firing tick creates one
// shard at `(0, 0)` with velocity `500 × (0.6, 0.8)` and pierce `-1`.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// at `(300, 400)`, then Shard held at level 1 and fired through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). `enemyMotion` is held so
// the moth stands where it was posed on the firing tick, and `effectMotion` is
// held so the shard stands at the center it was created at with the velocity
// the firing gave it. The shard is created `500` from the moth's center, so it
// hits nothing on its own tick and is present in the snapshot.
//
// TOLERANCE. `POSITION_TOL` on the shard's center against the player's, which
// the firing copies rather than integrates; `FLOAT_TOL` on the components of
// the shard's velocity, a speed times a unit vector a build computes from the
// two centers exactly as the harness does. The pierce is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  FLOAT_TOL,
  INFINITE_PIERCE,
  POSITION_TOL,
  weaponRow,
} from "../constants";
import {
  captureStill,
  createHarness,
  directionToward,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SHARD, shardsOf } from "./stage";

/** The level whose row is fired: one shard at `500` units per second. */
const LEVEL = 1;

/** The one moth: `500` from the origin along `(0.6, 0.8)`. */
const MOTH = { x: 300, y: 400 };

/** Shard's level-1 speed, `500`. */
const SPEED = weaponRow(SHARD, LEVEL).speed!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires a shard from the lamplighter's center at 500 × (0.6, 0.8) with pierce -1 toward a moth at (300, 400)", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SHARD, LEVEL);
  await captureStill(h, "aimed");

  const shards = shardsOf(firing);
  assertEqual(
    shards.length,
    1,
    "Shard projectiles the firing tick created at level 1",
  );
  const shard = shards[0]!;
  const at = firing.before.run.player;
  assertNear(shard.x, at.x, POSITION_TOL, "the shard's x at creation");
  assertNear(shard.y, at.y, POSITION_TOL, "the shard's y at creation");
  const toward = directionToward(firing.before, MOTH);
  assertNear(shard.vx, SPEED * toward.x, FLOAT_TOL, "the shard's velocity, x");
  assertNear(shard.vy, SPEED * toward.y, FLOAT_TOL, "the shard's velocity, y");
  assertEqual(shard.pierce, INFINITE_PIERCE, "the shard's pierce");
});
