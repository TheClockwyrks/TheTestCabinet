// ember/volley — what the points of this category share: an isolated night
// holding Ember alone at a level with its firing due on the next tick, the
// moths it is to aim at posed around the lamplighter, and the readings of the
// bolts the firing tick created against the row of `EMBER_LEVELS` in force.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Ember", "Derived stats", "Projectiles and pierce", and
// "Cooldown timers") that every row point asserts the same way.
//
// WHY A MOTH, AND WHY THESE PLACES. A moth is a circle of radius 10 with HP 5
// (specs/enemies.md), the smallest common enemy; the targets stand at least
// 150 units from the lamplighter's center, and a bolt is created AT that center
// and "first moving on the next tick" (specs/world.md, "One tick", phase 6), so
// no bolt overlaps a moth on the tick it is created (a bolt of radius 10 and a
// moth of radius 10 need a center distance below 20 to overlap) and every bolt
// is still in `projectiles` to read after the firing tick. The targets lie in
// three different directions, so a bolt aimed at one of them is told from a
// bolt aimed at another by its direction alone.

import { assertEqual, assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  cooldownFor,
  derived,
  type BoltRow,
} from "../constants";
import {
  armWeapon,
  holdWeapon,
  isolate,
  spawnEnemyNear,
  unit,
  type Harness,
  type Point,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";

/** The enemy every target of this category is: HP 5, radius 10. */
export const PROBE = "moth";

/**
 * Where a posed target stands, as an offset from the lamplighter's center, in
 * the order they are spawned: 150 units along +x, 200 along -y, and about 269
 * along a third direction. Every offset is beyond any overlap with a bolt
 * created at the center, and no two lie along one line.
 */
export const TARGET_OFFSETS: readonly Point[] = [
  { x: 150, y: 0 },
  { x: 0, y: -200 },
  { x: -250, y: 100 },
];

/** The first `count` of {@link TARGET_OFFSETS}. */
export function targetsFor(count: number): readonly Point[] {
  return TARGET_OFFSETS.slice(0, count);
}

/** One posed target: the moth's id and its center, in world units. */
export interface Target {
  id: number;
  at: Point;
}

/** What {@link armEmber} posed: the slot Ember took and the moths around it. */
export interface Volley {
  slot: number;
  targets: Target[];
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Ember alone at `level`, one moth at each
 * of `offsets` from the lamplighter's center, with Ember's timer at 0 and
 * `weaponFire` on, so the next `playing` tick is the firing tick:
 * "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `enemyMotion` off
 * holds each moth where it was posed, so the distances and directions the
 * firing tick reads are the posed ones; `effectMotion` off holds each bolt at
 * its launch position and velocity for the reading, as phase 6 would anyway
 * before its first move; `enemyContact` off keeps a moth from touching the
 * lamplighter.
 */
export function armEmber(
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
  const slot = holdWeapon(h, "ember", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "ember", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Ember's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Ember's posed timer");
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

/** The unit vector from the lamplighter's center to `target`'s center. */
export function directionTo(volley: Volley, target: Target): Point {
  return unit(target.at.x - volley.player.x, target.at.y - volley.player.y);
}

/** Whether `bolt`'s velocity points along `direction`, within `DIRECTION_TOLERANCE`. */
export function aimedAlong(
  bolt: ProjectileSnapshot,
  direction: Point,
): boolean {
  const heading = unit(bolt.vx, bolt.vy);
  return (
    Math.abs(heading.x - direction.x) <= DIRECTION_TOLERANCE &&
    Math.abs(heading.y - direction.y) <= DIRECTION_TOLERANCE
  );
}

/** Every bolt of `bolts` aimed at `target`, in ascending id. */
export function boltsAimedAt(
  volley: Volley,
  bolts: readonly ProjectileSnapshot[],
  target: Target,
): ProjectileSnapshot[] {
  const direction = directionTo(volley, target);
  return bolts.filter((bolt) => aimedAlong(bolt, direction));
}

/** Row `level` of EMBER_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function emberRow(level: number): BoltRow {
  return EMBER_LEVELS[level - 1];
}

/**
 * `bolt` carries the figures `row` gives a bolt fired with no passive held:
 * radius `row.radius × areaMul`, damage `row.damage × damageMul`, speed
 * `row.speed` as the length of its velocity, pierce `row.pierce`, and `ttl`
 * `row.duration`, each as specs/weapons.md ("Derived stats", "Ember", and
 * "Projectiles and pierce") states it. With nothing held every multiplier is
 * `1` (specs/passives.md).
 */
export function assertBoltOfRow(
  bolt: ProjectileSnapshot,
  row: BoltRow,
  context: string,
): void {
  assertWithin(
    bolt.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    bolt.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    Math.hypot(bolt.vx, bolt.vy),
    row.speed,
    FIGURE_TOLERANCE,
    `${context}: speed, the length of its velocity`,
  );
  assertEqual(bolt.pierce, row.pierce, `${context}: pierce`);
  assertWithin(
    bolt.ttl,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was fired`,
  );
}

/**
 * Ember's timer in `slot` reads `row`'s cooldown after the firing tick: "After
 * firing, the timer is set to the weapon's current cooldown", which "is the
 * table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
 * (specs/weapons.md, "Cooldown timers"), `1` times the table figure with no
 * Oil held.
 */
export function assertTimerOfRow(
  after: WickSnapshot,
  slot: number,
  row: BoltRow,
): void {
  assertWithin(
    after.run.weapons[slot]?.cooldown ?? Number.NaN,
    cooldownFor(row.cooldown, {}),
    FIGURE_TOLERANCE,
    "Ember's timer after the firing tick",
  );
}
