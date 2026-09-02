// sconce/boomerang — what the points of this category share: an isolated night
// holding Sconce alone at a level with its firing due on the next tick, the
// moths it is to aim at posed around the lamplighter, the readings of the
// sconces the firing tick created against the row of `SCONCE_LEVELS` in force,
// and the two figures the deceleration law gives after `n` moving ticks.
// CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them; the readings restate the rules of
// specs/weapons.md ("Sconce", "Derived stats", "Projectiles and pierce", and
// "Cooldown timers") that every row point asserts the same way.
//
// WHY A MOTH, AND WHY THERE. A moth is a circle of radius 10 with HP 5
// (specs/enemies.md), the smallest common enemy. "Sconce needs at least one
// enemy to fire" (specs/weapons.md, "Sconce"), so every firing point poses at
// least one. The moths stand 500, 600, 700, and 800 units from the
// lamplighter's center, distinct distances so "the live enemy whose center is
// the smallest Euclidean distance from the player's center" (specs/weapons.md,
// "The nearest enemy") is the first of them with no tie to break. A sconce is
// created AT that center and "first moving on the next tick" (specs/world.md,
// "One tick", phase 6), so no sconce overlaps a moth on the tick it is created
// (the widest sconce, radius 16, and a moth of radius 10 need a center
// distance below 26 to overlap) and every sconce is still in `projectiles` to
// read after the firing tick.
//
// WHY THE FURTHEST A SCONCE REACHES MATTERS. Under the law below a level-1
// sconce's outward reach is 305 units, at its 60th moving tick, so a sconce
// watched in flight never reaches the 500-unit moth and hits nothing over the
// flight the motion points read.

import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  INFINITE_PIERCE,
  SCONCE_DECEL,
  SCONCE_LEVELS,
  TICK_DT,
  cooldownFor,
  derived,
  type PersistentBoltRow,
} from "../constants";
import {
  armWeapon,
  disable,
  enable,
  holdWeapon,
  isolate,
  projectilesOf,
  spawnEnemyNear,
  unit,
  type Harness,
  type Point,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";

/** The enemy every posed target of this category is: HP 5, radius 10. */
export const PROBE = "moth";

/**
 * Where the posed targets stand, as offsets from the lamplighter's center, at
 * 500, 600, 700, and 800 units. A point poses the first `n` of them.
 */
export const ROW_TARGETS: readonly Point[] = [
  { x: 300, y: 400 },
  { x: -360, y: 480 },
  { x: 420, y: -560 },
  { x: -480, y: -640 },
];

/**
 * The launch direction `d` of a firing that poses {@link ROW_TARGETS}: "the
 * direction of the nearest enemy on the tick of firing" (specs/weapons.md,
 * "Sconce"), the unit vector toward the first target, `(300, 400) / 500`,
 * which is `(0.6, 0.8)`.
 */
export const AIM: Point = unit(ROW_TARGETS[0].x, ROW_TARGETS[0].y);

/** The first `count` of {@link ROW_TARGETS}. */
export function targetsFor(count: number): readonly Point[] {
  return ROW_TARGETS.slice(0, count);
}

/** One posed target: the moth's id and its center, in world units. */
export interface Target {
  id: number;
  at: Point;
}

/** What {@link armSconce} posed: the slot Sconce took and the moths around it. */
export interface Volley {
  slot: number;
  targets: Target[];
  /** The lamplighter's center on the posed tick. */
  player: Point;
  /** The night as posed, before the firing tick. */
  posed: WickSnapshot;
}

/**
 * Reset to an isolated night holding Sconce alone at `level`, one moth at each
 * of `offsets` from the lamplighter's center, with Sconce's timer at 0 and
 * `weaponFire` on, so the next `playing` tick is the firing tick:
 * "`setWeaponCooldown(slot, 0)` makes that the next tick"
 * (specs/instrumentation.md). Every other switch stays off: `enemyMotion` off
 * holds each moth where it was posed, so the distances and directions the
 * firing tick reads are the posed ones; `effectMotion` off holds each sconce
 * at its launch position and velocity for the reading, as phase 6 would anyway
 * before its first move; `enemyContact` off keeps a moth from touching the
 * lamplighter.
 */
export function armSconce(
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
  const slot = holdWeapon(h, "sconce", level);
  armWeapon(h, slot);
  const posed = h.snapshot();
  assertEqual(posed.run.weapons[slot]?.id, "sconce", "the weapon held");
  assertEqual(posed.run.weapons[slot]?.level, level, "Sconce's posed level");
  assertEqual(posed.run.weapons[slot]?.cooldown, 0, "Sconce's posed timer");
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

/** Row `level` of SCONCE_LEVELS: "row `i` is level `i + 1`" (specs/weapons.md). */
export function sconceRow(level: number): PersistentBoltRow {
  return SCONCE_LEVELS[level - 1];
}

/** The one sconce a level-1 firing launched, and where it launched from. */
export interface Launch {
  /** The sconce as the firing tick left it, before any moving tick. */
  sconce: ProjectileSnapshot;
  /**
   * The launch point, "where the player's center was on the tick of firing"
   * (specs/weapons.md, "Sconce").
   */
  from: Point;
  /** The night as posed, and the moth posed in it. */
  volley: Volley;
}

/**
 * Pose {@link armSconce} at level 1 with the one nearest moth, run the firing
 * tick, and hand back the single sconce it launched. Level 1 has amount `1`,
 * so the launch is one sconce along {@link AIM} with no spread to unpick.
 */
export async function launchOne(h: Harness): Promise<Launch> {
  const volley = armSconce(h, 1, targetsFor(1));
  const fired = await h.tick(1);
  const sconces = projectilesOf(fired, "sconce");
  assertLength(sconces, 1, "Sconce projectiles after the firing tick");
  return { sconce: sconces[0], from: { ...volley.player }, volley };
}

/**
 * Hand the night over to the flight: `weaponFire` off, so nothing fires again
 * while the sconce is watched, and `effectMotion` on, the faculty under which
 * "sconces decelerate" (specs/world.md, "One tick", phase 6).
 */
export function beginFlight(h: Harness): void {
  disable(h, "weaponFire");
  enable(h, "effectMotion");
}

/**
 * The speed along `d` after `n` moving ticks: "after `n` moving ticks its
 * velocity is `(speed − SCONCE_DECEL × n × TICK_DT) × d`" (specs/weapons.md,
 * "Sconce").
 */
export function speedAfter(speed: number, n: number): number {
  return speed - SCONCE_DECEL * n * TICK_DT;
}

/**
 * How far along `d` the sconce sits after `n` moving ticks, from its launch
 * point. Each moving tick advances the position by the velocity it carried
 * into the tick and only then changes that velocity (specs/weapons.md,
 * "Projectiles and pierce"), so the displacement is the sum of
 * {@link speedAfter} at `0` through `n − 1`, each times `TICK_DT`.
 */
export function outwardAfter(speed: number, n: number): number {
  let along = 0;
  for (let k = 0; k < n; k += 1) along += speedAfter(speed, k) * TICK_DT;
  return along;
}

/**
 * The moving tick the sconce is back at its launch point on: the whole `n`
 * that solves {@link outwardAfter} `= 0`, which is
 * `2 × speed / (SCONCE_DECEL × TICK_DT) + 1`.
 */
export function returnTick(speed: number): number {
  return (2 * speed) / (SCONCE_DECEL * TICK_DT) + 1;
}

/**
 * `sconce` carries the figures `row` gives a sconce launched with no passive
 * held: radius `row.radius × areaMul`, damage `row.damage × damageMul`, speed
 * `row.speed` as the length of its velocity, pierce `INFINITE_PIERCE`, and
 * `ttl` `row.duration`, each as specs/weapons.md ("Derived stats", "Sconce",
 * and "Projectiles and pierce") states it. With nothing held every multiplier
 * is `1` (specs/passives.md).
 */
export function assertSconceOfRow(
  sconce: ProjectileSnapshot,
  row: PersistentBoltRow,
  context: string,
): void {
  assertWithin(
    sconce.radius,
    row.radius * derived.areaMul({}),
    FIGURE_TOLERANCE,
    `${context}: radius`,
  );
  assertWithin(
    sconce.damage,
    row.damage * derived.damageMul({}),
    FIGURE_TOLERANCE,
    `${context}: damage`,
  );
  assertWithin(
    Math.hypot(sconce.vx, sconce.vy),
    row.speed,
    FIGURE_TOLERANCE,
    `${context}: speed, the length of its velocity`,
  );
  assertEqual(sconce.pierce, INFINITE_PIERCE, `${context}: pierce`);
  assertWithin(
    sconce.ttl,
    row.duration,
    FIGURE_TOLERANCE,
    `${context}: ttl on the tick it was launched`,
  );
}

/**
 * Sconce's timer in `slot` reads `row`'s cooldown after the firing tick:
 * "After firing, the timer is set to the weapon's current cooldown", which "is
 * the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN`"
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
    "Sconce's timer after the firing tick",
  );
}
