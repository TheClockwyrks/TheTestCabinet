// shard/firing — one posed Shard firing, shared by the checks in this
// directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Shard "fires whether or not any enemy exists"
// (`specs/weapons.md`, Shard): "toward the nearest enemy, or in the facing
// direction when no enemy exists". So a check on a fired shard poses an
// isolated run, stands the moths it wants in the world (none, for the facing
// fallback), holds Shard at the level under test, and runs the one tick on
// which it fires. That arrangement is spelled once here and decides nothing:
// the moths are placed through the surface's real spawn path, Shard through
// `setWeapon`, the firing through `setWeaponCooldown(slot, 0)` and
// `weaponFire` on ("`setWeaponCooldown(slot, 0)` makes that the next tick",
// `specs/instrumentation.md`), and what the tick created is read back by id,
// telling this tick's shards from anything posed before it.
//
// WHERE THE MOTH STANDS. `TARGET_POST`, `(300, 400)`, is `TARGET_DISTANCE`
// (500) units from the origin, where the lamplighter stands in an isolated
// run; its unit vector from the origin is exactly `(0.6, 0.8)`. 500 units is
// far outside every overlap a shard could make on the tick it is created: a
// shard of radius at most 10 at the player's center and a moth of radius 10
// overlap only inside 20 units (`specs/weapons.md`, Shapes and overlap), so
// the firing tick creates shards and hits nothing, and the count a check
// reads is the count fired. `enemyMotion` is off, so the moth stands where it
// was posed on the firing tick, and `enemyContact` is off, so it never
// touches the lamplighter.

import {
  advanceTicks,
  armWeapon,
  holdWeapon,
  isolate,
  placeEnemyNear,
  projectilesCreatedSince,
  type Harness,
  type Point,
  type SnapshotProjectile,
  type WickSnapshot,
} from "../harness";

/** The two values `facing` takes (`specs/world.md`, Facing). */
export type Facing = "left" | "right";

/** How far from the lamplighter the moth stands. */
export const TARGET_DISTANCE = 500;

/** The one post: the 3-4-5 point `(300, 400)`, `TARGET_DISTANCE` out. */
export const TARGET_POST: Point = { x: 300, y: 400 };

export interface FireOptions {
  /** The facing to pose before the firing tick; left as the run began it when omitted. */
  facing?: Facing;
}

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Shard was placed in. */
  slot: number;
  /** The moths' ids, in the order their posts were given. */
  targets: number[];
  /** The state before the firing tick, with Shard armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The projectiles the firing tick created, in id order. */
  shards: SnapshotProjectile[];
}

/**
 * Pose an isolated run with a moth at each of `posts`, hold Shard at `level`
 * armed to fire on the next tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but what is placed here: no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on. `effectMotion` stays off, so the
 * velocity read after the tick is exactly what the firing gave each shard.
 */
export async function fireShard(
  h: Harness,
  level: number,
  posts: readonly Point[],
  options: FireOptions = {},
): Promise<Firing> {
  isolate(h);
  if (options.facing !== undefined) h.debug.setFacing(options.facing);
  const targets = posts.map((post) =>
    placeEnemyNear(h, "moth", post.x, post.y),
  );
  const slot = holdWeapon(h, "shard", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slot,
    targets,
    before,
    after,
    shards: projectilesCreatedSince(before, after),
  };
}
