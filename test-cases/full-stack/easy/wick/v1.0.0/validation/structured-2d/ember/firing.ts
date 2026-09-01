// ember/firing — one posed Ember firing, shared by the checks in this
// directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Ember "needs at least one enemy to fire"
// (`specs/weapons.md`, Ember), so every check on a bolt poses an isolated run,
// stands some moths in the world, holds Ember at the level under test, and
// runs the one tick on which it fires. That arrangement is spelled once here
// and decides nothing: the moths are placed through the surface's real spawn
// path, Ember through `setWeapon`, the firing through `setWeaponCooldown(slot,
// 0)` and `weaponFire` on ("`setWeaponCooldown(slot, 0)` makes that the next
// tick", `specs/instrumentation.md`), and what the tick created is read back
// by id, telling this tick's bolts from anything posed before it.
//
// WHERE THE MOTHS STAND. Each post is `TARGET_DISTANCE` (500) units from the
// origin, where the lamplighter stands in an isolated run, in a direction of
// its own, so `n` posts are `n` distinct targets and no two tie for nearest.
// 500 units is far outside every overlap a bolt could make on the tick it is
// created: a bolt of radius 8 at the player's center and a moth of radius 10
// overlap only inside 18 units (`specs/weapons.md`, Shapes and overlap), so
// the firing tick creates bolts and hits nothing, and the count a check reads
// is the count fired. `enemyMotion` is off, so the moths stand where they
// were posed on the firing tick, and `enemyContact` is off, so none of them
// hits the lamplighter. The first post, `(300, 400)`, is the one the aim
// check uses: its unit vector from the origin is exactly `(0.6, 0.8)`.

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

/** How far from the lamplighter each post stands. */
export const TARGET_DISTANCE = 500;

/**
 * Three posts `TARGET_DISTANCE` out in three distinct directions: the 3-4-5
 * point `(300, 400)`, its mirror across the y axis, and straight up.
 */
export const TARGET_POSTS: readonly Point[] = [
  { x: 300, y: 400 },
  { x: -300, y: 400 },
  { x: 0, y: -500 },
];

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Ember was placed in. */
  slot: number;
  /** The moths' ids, in the order their posts were given. */
  targets: number[];
  /** The state before the firing tick, with Ember armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The projectiles the firing tick created, in id order. */
  bolts: SnapshotProjectile[];
}

/**
 * Pose an isolated run with a moth at each of `posts`, hold Ember at `level`
 * armed to fire on the next tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but what is placed here: no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on.
 */
export async function fireEmber(
  h: Harness,
  level: number,
  posts: readonly Point[],
): Promise<Firing> {
  isolate(h);
  const targets = posts.map((post) =>
    placeEnemyNear(h, "moth", post.x, post.y),
  );
  const slot = holdWeapon(h, "ember", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slot,
    targets,
    before,
    after,
    bolts: projectilesCreatedSince(before, after),
  };
}
