// pickups/night — what the points of this category share: the readings of a
// gem and a pickup by id, and the one kill that leaves a drop on the field.
// CASE-PROVIDED.
//
// No review item names this file. Each function is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them.
//
// WHY A KILL IS POSED THROUGH A BOLT. specs/instrumentation.md (`setEnemyHp`)
// sets an enemy's `hp` to "a real number above `0` and at most its `maxHp`", so
// a pose can never kill; "every hit, kill, drop, collection, level-up,
// evolution, and ending comes from the ticks run after the pose". The death is
// therefore decided by the tick a posed Ember bolt hits on, and the drop the
// death leaves is the one specs/enemies.md ("Drops") states for the row's rank.
// specs/instrumentation.md (`setEffectMotion`): with `effectMotion` off "`ttl`
// and every re-hit entry still count, and hits still resolve", so the bolt hits
// from the point it was posed at.

import { assertGreaterThan } from "../assert";
import { EMBER_LEVELS, GEM_SPEED, TICK_DT, type EnemyId } from "../constants";
import {
  enemyById,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type GemSnapshot,
  type Harness,
  type PickupSnapshot,
  type Point,
  type WickSnapshot,
} from "../harness";

/**
 * One tick's flight step, `GEM_SPEED × TICK_DT`: 10 units.
 *
 * specs/world.md ("Attraction and flight"): "An attracted gem moves toward the
 * lamplighter's center each tick by `GEM_SPEED × TICK_DT`", with `GEM_SPEED`
 * 600 units per second and `TICK_DT` 1/60 seconds.
 */
export const GEM_STEP = GEM_SPEED * TICK_DT;

/** The gem `id` names, or the point fails because it is gone. */
export function gemOf(snapshot: WickSnapshot, id: number): GemSnapshot {
  return present(
    snapshot.run.gems.find((gem) => gem.id === id),
    `the gem ${id}`,
  );
}

/** The gem `id` names, or `undefined` once it has been collected. */
export function gemById(
  snapshot: WickSnapshot,
  id: number,
): GemSnapshot | undefined {
  return snapshot.run.gems.find((gem) => gem.id === id);
}

/** The pickup `id` names, or the point fails because it is gone. */
export function pickupOf(snapshot: WickSnapshot, id: number): PickupSnapshot {
  return present(
    snapshot.run.pickups.find((pickup) => pickup.id === id),
    `the pickup ${id}`,
  );
}

/** The pickup `id` names, or `undefined` once it has been collected. */
export function pickupById(
  snapshot: WickSnapshot,
  id: number,
): PickupSnapshot | undefined {
  return snapshot.run.pickups.find((pickup) => pickup.id === id);
}

/** How far `point` sits from the lamplighter's center, in units. */
export function distanceToPlayer(snapshot: WickSnapshot, point: Point): number {
  const { player } = snapshot.run;
  return Math.hypot(point.x - player.x, point.y - player.y);
}

/** The hp an enemy is posed to before the bolt, below one bolt's damage. */
const POSED_HP = 1;

/**
 * Stand one enemy of `type` at `(dx, dy)` from the lamplighter's center, pose
 * its `hp` to `POSED_HP`, and put one Ember bolt on its center, so the next
 * tick kills it and leaves whatever its rank drops at that point.
 *
 * The enemy's center, for the reading of where the drop landed.
 */
export function armKill(
  h: Harness,
  type: EnemyId,
  dx: number,
  dy: number,
): Point {
  const id = spawnEnemyNear(h, type, dx, dy);
  const placed = present(enemyById(h.snapshot(), id), `the posed ${type}`);
  h.debug.setEnemyHp(id, POSED_HP);
  assertGreaterThan(
    EMBER_LEVELS[0].damage,
    POSED_HP,
    `the bolt's damage against the posed hp of the ${type}`,
  );
  spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);
  return { x: placed.x, y: placed.y };
}
