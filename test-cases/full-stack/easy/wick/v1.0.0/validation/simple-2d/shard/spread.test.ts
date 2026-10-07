// Wick — shard/spread: two shards leave at directions rotated -7.5 and +7.5
// degrees from the direction toward the nearest enemy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "Amount `n` fires `n` shards on the same
//     tick, shard `i` counted from `0` with its direction rotated by
//     `(i − (n − 1) / 2) × SHARD_SPREAD` degrees, with `SHARD_SPREAD` (`15`)";
//     the level-3 row has amount `2`, so the two rotations are
//     `(0 − 0.5) × 15`, which is `-7.5`, and `(1 − 0.5) × 15`, which is
//     `+7.5`.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy
//     is the unit vector from the player's center to the enemy's center", and
//     "Angles are in degrees, with `0` along `+x` and positive angles turning
//     toward `+y`". A moth at `(300, 400)` from the center gives the direction
//     `(0.6, 0.8)`.
//   - `specs/weapons.md` ("Derived stats"): amount is "table value +
//     `amountBonus`", `0` with no Mirror held (`specs/passives.md`).
//   - `specs/world.md` ("One tick"), phase 6: a new projectile "first moving
//     on the next tick", so the launch velocities are what the firing tick
//     leaves.
//
// WHAT IS READ. After the firing tick: exactly two Shard projectiles, and the
// unit velocity of each against the aim rotated by `-7.5` and by `+7.5`
// degrees, one shard per rotation, as a set rather than by id. The two
// rotations are symmetric about the aim, so which shard carries which is not
// something the specification fixes, and a build whose shards both leave
// along the aim, or spread by some other angle, or turn the wrong way about
// `+y`, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Shard alone at level 3, every
// switch off but `weaponFire`. `enemyMotion` off holds the moth for the firing
// tick's read of the nearest enemy; `effectMotion` off holds each shard at its
// launch velocity for the reading. The moth is `500` units out, so no shard
// overlaps it on the firing tick.
//
// TOLERANCE. `DIRECTION_TOLERANCE` on each component of a unit velocity,
// against a rotation of an exact unit vector by an exact angle. None on the
// count, a whole number the row states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DIRECTION_TOLERANCE, SHARD_SPREAD } from "../constants";
import {
  captureStill,
  createHarness,
  projectilesOf,
  rotate,
  unit,
  type Harness,
  type Point,
  type ProjectileSnapshot,
} from "../harness";
import { armShard, shardRow } from "./volley";

/** The level whose row has amount 2. */
const LEVEL = 3;

/** The one moth, 500 units from the lamplighter's center. */
const MOTH = { x: 300, y: 400 };

/** The aim: the unit vector toward it, `(0.6, 0.8)`. */
const AIM = unit(MOTH.x, MOTH.y);

/** The rotations of a two-shard firing: `(i − 0.5) × 15` for `i` of 0 and 1. */
const ROTATIONS = [0, 1].map((i) => (i - (2 - 1) / 2) * SHARD_SPREAD);

/** The directions the two shards must leave along, one each. */
const DIRECTIONS: readonly Point[] = ROTATIONS.map((deg) => rotate(AIM, deg));

/** Whether `shard`'s unit velocity is `direction` within `DIRECTION_TOLERANCE`. */
function leavesAlong(shard: ProjectileSnapshot, direction: Point): boolean {
  const heading = unit(shard.vx, shard.vy);
  return (
    Math.abs(heading.x - direction.x) <= DIRECTION_TOLERANCE &&
    Math.abs(heading.y - direction.y) <= DIRECTION_TOLERANCE
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the two level-3 shards at -7.5 and +7.5 degrees from the aim", async () => {
  assertEqual(shardRow(LEVEL).amount, 2, "the level-3 row's amount");
  armShard(h, LEVEL, [MOTH]);

  const after = await h.tick(1);
  captureStill(h, "spread");

  const shards = projectilesOf(after, "shard");
  assertLength(shards, 2, "Shard projectiles after the firing tick");
  for (const [i, direction] of DIRECTIONS.entries()) {
    const along = shards.filter((shard) => leavesAlong(shard, direction));
    assertLength(
      along,
      1,
      `shards leaving at ${ROTATIONS[i]} degrees from the aim, ` +
        `unit velocities ${JSON.stringify(shards.map((s) => unit(s.vx, s.vy)))}`,
    );
  }
});
