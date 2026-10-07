// sconce/firing — one posed Sconce firing, shared by the checks in this
// directory. CASE-PROVIDED.
//
// WHAT EVERY CHECK HERE SHARES. Sconce "needs at least one enemy to fire"
// (`specs/weapons.md`, Sconce), so every check on a launched sconce poses an
// isolated run, stands the moths it wants in the world, holds Sconce at the
// level under test, and runs the one tick on which it fires. That arrangement
// is spelled once here and decides nothing: the moths are placed through the
// surface's real spawn path, Sconce through `setWeapon`, the firing through
// `setWeaponCooldown(slot, 0)` and `weaponFire` on ("`setWeaponCooldown(slot,
// 0)` makes that the next tick", `specs/instrumentation.md`), and what the
// tick created is read back by id, telling this tick's sconces from anything
// posed before it.
//
// WHERE THE MOTHS STAND. Each post is a distinct distance from the origin,
// where the lamplighter stands in an isolated run, in a direction of its own,
// so the nearest enemy is post `0` whatever the count, with no tie to break.
// The first post, `(300, 400)`, is `TARGET_DISTANCE` (500) out and its unit
// vector from the origin is exactly `(0.6, 0.8)`, which is the launch
// direction every check here measures against. 500 units is far outside every
// overlap a sconce could make on the tick it is created: a sconce of radius at
// most 16 at the player's center and a moth of radius 10 overlap only inside
// 26 units (`specs/weapons.md`, Shapes and overlap), so the firing tick
// creates sconces and hits nothing, and the count a check reads is the count
// launched. `enemyMotion` is off, so the moths stand where they were posed on
// the firing tick, and `enemyContact` is off, so none of them hits the
// lamplighter. `effectMotion` is off too, so a velocity read after the firing
// tick is exactly the one the launch gave.

import {
  advanceTicks,
  armWeapon,
  holdWeapon,
  isolate,
  placeEnemyNear,
  projectilesCreatedSince,
  unit,
  type Harness,
  type Point,
  type SnapshotProjectile,
  type WickSnapshot,
} from "../harness";

/** How far from the lamplighter the first post stands. */
export const TARGET_DISTANCE = 500;

/**
 * Four posts at four distinct distances in four distinct directions, so that
 * post `0` is the nearest enemy however many of them are standing. Row 8
 * launches four sconces, which is as many posts as any check here needs.
 */
export const TARGET_POSTS: readonly Point[] = [
  { x: 300, y: 400 },
  { x: -312, y: 416 },
  { x: 0, y: -540 },
  { x: 560, y: 0 },
];

/** The launch direction the first post gives: the unit vector `(0.6, 0.8)`. */
export const LAUNCH_DIRECTION: Point = unit(
  TARGET_POSTS[0].x,
  TARGET_POSTS[0].y,
);

/** What one posed firing tick left. */
export interface Firing {
  /** The slot Sconce was placed in. */
  slot: number;
  /** The moths' ids, in the order their posts were given. */
  targets: number[];
  /** The state before the firing tick, with Sconce armed. */
  before: WickSnapshot;
  /** The state after the firing tick. */
  after: WickSnapshot;
  /** The projectiles the firing tick created, in id order. */
  sconces: SnapshotProjectile[];
}

/**
 * Pose an isolated run with a moth at each of `posts`, hold Sconce at `level`
 * armed to fire on the next tick, run that one tick, and read what it left.
 *
 * `isolate` first, so the run holds nothing but what is placed here: no other
 * weapon (Taper removed), no passive, every driver switch off but the
 * `weaponFire` that `armWeapon` turns on.
 */
export async function fireSconce(
  h: Harness,
  level: number,
  posts: readonly Point[],
): Promise<Firing> {
  isolate(h);
  const targets = posts.map((post) =>
    placeEnemyNear(h, "moth", post.x, post.y),
  );
  const slot = holdWeapon(h, "sconce", level);
  armWeapon(h, slot);
  const before = h.snapshot();
  const after = await advanceTicks(h, 1);
  return {
    slot,
    targets,
    before,
    after,
    sconces: projectilesCreatedSince(before, after),
  };
}
