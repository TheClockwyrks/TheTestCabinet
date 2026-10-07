// shard/volley — what the points of this category share: an isolated night
// holding Shard alone at a level with its firing due on the next tick, the
// moth it is to aim at posed beside the lamplighter, and the readings of the
// shards the firing tick created against the row of `SHARD_LEVELS` in force.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Shard", "Derived stats", "Projectiles and pierce", and
// "Cooldown timers") that every row point asserts the same way.
//
// WHY A MOTH, AND WHY THERE. A moth is a circle of radius 10 with HP 5
// (specs/enemies.md), the smallest common enemy. "Shard fires whether or not
// any enemy exists" (specs/weapons.md, "Shard"), so a row point needs no
// target at all; one moth is posed anyway, so the firing a row is read off is
// the one a night ordinarily produces, aimed at an enemy, and a build that
// fires only along the facing direction is still graded on its table here and
// on its aiming by the aiming points. The moth stands 150 units from the
// lamplighter's center, and a shard is created AT that center and "first moving
// on the next tick" (specs/world.md, "One tick", phase 6), so no shard overlaps
// the moth on the tick it is created (the widest shard, radius 10, and a moth
// of radius 10 need a center distance below 20 to overlap) and every shard is
// still in `projectiles` to read after the firing tick.

import { assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  SHARD_LEVELS,
  cooldownFor,
  derived,
  type PersistentBoltRow,
} from "../constants";
import {
  armWeapon,
  holdWeapon,
  isolate,
  spawnEnemyNear,
  type Harness,
  type Point,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";

/** The enemy every posed target of this category is: HP 5, radius 10. */
export const PROBE = "moth";

/**
 * Where the row points' one target stands, as an offset from the lamplighter's
 * center: 150 units along +x, beyond any overlap with a shard created at the
 * center.
 */
export const ROW_TARGET: Point = { x: 150, y: 0 };

/** One posed target: the moth's id and its center, in world units. */
export interface Target {
  id: number;
  at: Point;
}

/** What {@link armShard} posed: the slot Shard took and the moths around it. */
export interface Volley {
  slot: number;
  targets: Target[];
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Shard alone at `level`, one moth at each
 * of `offsets` from the lamplighter's center, with Shard's timer at 0 and
 * `weaponFire` on, so the next `playing` tick is the firing tick:
 * "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `enemyMotion` off
 * holds each moth where it was posed, so the distances and directions the
 * firing tick reads are the posed ones; `effectMotion` off holds each shard at
 * its launch position and velocity for the reading, as phase 6 would anyway
 * before its first move; `enemyContact` off keeps a moth from touching the
 * lamplighter.
 */
export function armShard(
  h: Harness,
  level: number,
  offsets: readonly Point[],
): Volley {
  isolate(h);
  const player = { ...h.snapshot().run.player };
  const targets: Target[] = offsets.map((offset) => ({
    id: spawnEnemyNear(h, PROBE, offset.x, offset.y),
    at: { x: player.x + offset.x, y: player.y + offset.y },
  }));
  const slot = holdWeapon(h, "shard", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "shard", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Shard's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Shard's posed timer");
  assertEqual(posed.weaponFire, true, "weaponFire before the firing tick");
  assertEqual(
    posed.run.enemies.length,
    offsets.length,
    "moths alive before the firing tick",
  );
  assertEqual(
    posed.run.projectiles.length,
    0,
    "projectiles before the firing tick",
  );
  return { slot, targets, player: { x: player.x, y: player.y }, posed };
}

/** Row `level` of SHARD_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function shardRow(level: number): PersistentBoltRow {
  return SHARD_LEVELS[level - 1];
}

/**
 * `shard` carries the figures `row` gives a shard fired with no passive held:
 * radius `row.radius × areaMul`, damage `row.damage × damageMul`, speed
 * `row.speed` as the length of its velocity, pierce `INFINITE_PIERCE`, and
 * `ttl` `row.duration`, each as specs/weapons.md ("Derived stats", "Shard",
 * and "Projectiles and pierce") states it. With nothing held every multiplier
 * is `1` (specs/passives.md).
 */
export function assertShardOfRow(
  shard: ProjectileSnapshot,
  row: PersistentBoltRow,
  context: string,
): void {
  assertWithin(
    shard.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    shard.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    Math.hypot(shard.vx, shard.vy),
    row.speed,
    FIGURE_TOLERANCE,
    `${context}: speed, the length of its velocity`,
  );
  assertEqual(shard.pierce, INFINITE_PIERCE, `${context}: pierce`);
  assertWithin(
    shard.ttl,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was fired`,
  );
}

/**
 * Shard's timer in `slot` reads `row`'s cooldown after the firing tick: "After
 * firing, the timer is set to the weapon's current cooldown", which "is the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/weapons.md, "Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: PersistentBoltRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    "Shard's timer after the firing tick",
  );
}
