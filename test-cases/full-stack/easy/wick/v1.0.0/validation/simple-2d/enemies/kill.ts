// enemies/kill — what the thirteen drop points and the kill-count point share:
// one enemy killed by one weapon, far from the lamplighter, and the field read
// on the tick it died. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide keeps beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/enemies.md ("The life of an enemy", "Drops") and specs/world.md ("One
// tick", "Gems", "Pickups") that each drop point asserts of its own row.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/enemies.md ("The life of an enemy"): "On any tick that leaves `hp`
//     at or below `0` the enemy dies on that tick: it is removed, the kill
//     count rises by one, its drop appears at its center".
//   - specs/enemies.md ("Drops"): "A death leaves its drop at the enemy's
//     center on the tick it dies", a `common` leaving "One gem of the tier in
//     its row", an `elite` "One chest", and the `dark` "Nothing".
//   - specs/instrumentation.md (`spawnProjectile`): a posed bolt's `damage` is
//     "that row's damage times the `damageMul` in force at the call", read at
//     "level `1`" for a weapon that is not held, and it "first hits ... on the
//     next tick"; (`setEnemyHp`) sets an enemy's `hp` to "a real number above
//     `0` and at most its `maxHp`".
//   - specs/instrumentation.md (`setEffectMotion`): with `effectMotion` off
//     "`ttl` and every re-hit entry still count, and hits still resolve", so
//     the bolt hits from where it was posed.
//   - specs/world.md ("Gems"): a gem "sits where it was dropped until it is
//     attracted", and a gem is attracted only "within `pickupRadius`" (`48`
//     with no Lure held); ("Collection"): a pickup is collected only within
//     `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`) of the
//     lamplighter's center.
//
// WHY THE NIGHT IS POSED AS IT IS. One enemy of the row's type stands 150 units
// along +x of the lamplighter, every switch off but `drops` and no weapon held:
// nothing spawns, nothing moves, nothing else can remove the enemy or leave
// anything on the ground. `drops` is the one faculty every point sharing this
// pose is ABOUT, so it is the one switch turned back on. 150 units is past both collection distances, so whatever the
// death leaves lies where the enemy stood for the reading. The enemy's `hp` is
// posed to 1 so that one bolt of the level-1 Ember row's damage (10) kills any
// of the thirteen rows on its first hit, from the gnat's 2 to the Dark's 10000,
// and every drop point reads the same single tick.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on a dropped thing's position, which is
// the enemy's posed center copied over; none on a count, a tier, or a kind,
// which the specification decides exactly.

import {
  assertEqual,
  assertGreaterThan,
  assertUndefined,
  assertWithin,
} from "../assert";
import { EMBER_LEVELS, FIGURE_TOLERANCE, type EnemyId } from "../constants";
import {
  captureStill,
  enable,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/** Where the enemy stands: past the pickup radius and the collection distance. */
export const KILL_DX = 150;

/** The hp the enemy is posed to, below the damage one Ember bolt carries. */
const POSED_HP = 1;

/** What one killing tick left behind. */
export interface Kill {
  /** The night before the killing tick. */
  before: WickSnapshot;
  /** The night after it. */
  after: WickSnapshot;
  /** Where the enemy stood when it died. */
  at: Point;
}

/**
 * Kill one enemy of `type` with one posed Ember bolt on its center and read the
 * tick it died on, keeping that frame as the point's `outputId` output.
 *
 * The bolt is the killing weapon, not the pose: `setEnemyHp` leaves the enemy
 * alive ("a real number above `0`"), and the death is decided by the tick the
 * bolt hits on, "every hit, kill, drop, collection, level-up, evolution, and
 * ending comes from the ticks run after the pose" (specs/instrumentation.md).
 */
export async function killByBolt(
  h: Harness,
  type: EnemyId,
  outputId: string,
): Promise<Kill> {
  isolate(h);
  // The drop is the requirement, so the faculty that makes it is on and every
  // other stays held.
  enable(h, "drops");
  const id = spawnEnemyNear(h, type, KILL_DX, 0);
  const placed = present(enemyById(h.snapshot(), id), `the posed ${type}`);
  h.debug.setEnemyHp(id, POSED_HP);
  assertGreaterThan(
    EMBER_LEVELS[0].damage,
    POSED_HP,
    `the bolt's damage against the posed hp of the ${type}`,
  );
  spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);
  const before = h.snapshot();
  assertEqual(before.run.gems.length, 0, "gems before the killing tick");
  assertEqual(before.run.pickups.length, 0, "pickups before the killing tick");

  const after = await h.tick(1);
  captureStill(h, outputId);

  assertUndefined(enemyById(after, id), `the ${type} after the killing tick`);
  return { before, after, at: { x: placed.x, y: placed.y } };
}

/** A dropped thing lies at `at`, the center the enemy died on. */
export function assertDroppedAt(
  dropped: Point,
  at: Point,
  context: string,
): void {
  assertWithin(dropped.x, at.x, FIGURE_TOLERANCE, `${context}: x`);
  assertWithin(dropped.y, at.y, FIGURE_TOLERANCE, `${context}: y`);
}
