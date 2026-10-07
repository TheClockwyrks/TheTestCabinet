// Wick — the hits, the third part of phase 6 (specs/weapons.md "Shapes and
// overlap", "Hits and death", "Projectiles and pierce", "Persistent
// effects", specs/evolutions.md "Pyre", "Corona").
//
// Every projectile and zone hits, this tick's new ones included. A hit takes
// the shape's damage per hit off the enemy's `hp`; whether the enemy dies is
// decided after every shape has hit. Projectiles hit first, in the order they
// were created, then the zones in theirs; a projectile with finite pierce
// hits the enemies it overlaps in ascending id until it is removed.

import {
  CORONA_HEAL,
  CUES,
  ENEMIES,
  FLARE_IMMUNE,
  INFINITE_PIERCE,
  LANTERN_REHIT,
  PYRE_HEAL,
} from "../constants";
import type {
  EnemyState,
  EnemyHit,
  ProjectileState,
  ZoneState,
} from "../state";
import type { TickContext } from "./context";
import { circlesOverlap, distance, rectCircleOverlap } from "./geometry";
import { heal } from "./lamplighter";
import { isDue } from "./timers";
import { pulseInterval, rehitInterval } from "./weapons";

/** Whether `shape` overlaps `enemy`'s circle. */
function overlaps(
  shape: { x: number; y: number; radius: number },
  enemy: EnemyState,
): boolean {
  return circlesOverlap(shape, shape.radius, enemy, ENEMIES[enemy.type].radius);
}

/** Whether `enemy`'s center is within `reach` of `point`. */
function within(
  point: { x: number; y: number },
  reach: number,
  enemy: EnemyState,
): boolean {
  return distance(point, enemy) <= reach;
}

/** One hit: the damage lands, the cue sounds, and the evolved heals apply. */
function land(
  ctx: TickContext,
  shape: ProjectileState | ZoneState,
  enemy: EnemyState,
): void {
  const before = enemy.hp;
  enemy.hp -= shape.damage;
  ctx.cues.add(CUES.hit);
  if (shape.weapon === "pyre") heal(ctx, PYRE_HEAL);
  if (shape.weapon === "corona" && before > 0 && enemy.hp <= 0) {
    heal(ctx, CORONA_HEAL);
  }
}

/**
 * A touching effect hits an enemy on any tick they overlap, at most once per
 * re-hit interval per effect per enemy, timed from the previous hit.
 */
function touch(
  ctx: TickContext,
  shape: ProjectileState | ZoneState,
  enemy: EnemyState,
  interval: number,
): void {
  const entry = shape.hits.find((hit) => hit.enemy === enemy.id);
  if (entry && !isDue(entry.cooldown)) return;
  land(ctx, shape, enemy);
  if (entry) entry.cooldown = interval;
  else shape.hits.push({ enemy: enemy.id, cooldown: interval });
}

/**
 * A projectile hits the enemies it overlaps. With finite pierce it hits each
 * enemy at most once, in ascending id, each hit lowering `pierce` by one and
 * a hit at `0` removing it; the entry it records lasts as long as it does.
 * With infinite pierce it is a touching effect on its weapon's interval.
 * Returns whether the projectile survives the tick.
 */
function projectileHits(
  ctx: TickContext,
  projectile: ProjectileState,
  enemies: readonly EnemyState[],
): boolean {
  for (const enemy of enemies) {
    if (!overlaps(projectile, enemy)) continue;
    if (projectile.pierce === INFINITE_PIERCE) {
      touch(ctx, projectile, enemy, rehitInterval(projectile.weapon));
      continue;
    }
    if (projectile.hits.some((hit) => hit.enemy === enemy.id)) continue;
    land(ctx, projectile, enemy);
    const entry: EnemyHit = { enemy: enemy.id, cooldown: projectile.ttl };
    projectile.hits.push(entry);
    if (projectile.pierce === 0) return false;
    projectile.pierce -= 1;
  }
  return true;
}

/** A zone hits as its kind states. */
function zoneHits(
  ctx: TickContext,
  zone: ZoneState,
  enemies: readonly EnemyState[],
): void {
  const { run } = ctx;
  const bornNow = zone.bornTick === run.tick;
  switch (zone.kind) {
    case "slash": {
      if (!bornNow) return;
      const width = zone.width ?? 0;
      const height = zone.height ?? 0;
      for (const enemy of enemies) {
        if (
          rectCircleOverlap(
            zone,
            width,
            height,
            enemy,
            ENEMIES[enemy.type].radius,
          )
        ) {
          land(ctx, zone, enemy);
        }
      }
      return;
    }
    case "strike":
      if (!bornNow) return;
      for (const enemy of enemies) {
        if (within(zone, zone.radius, enemy)) land(ctx, zone, enemy);
      }
      return;
    case "burst":
      if (!bornNow) return;
      for (const enemy of enemies) {
        if (FLARE_IMMUNE.includes(enemy.type)) continue;
        if (within(zone, zone.radius, enemy)) land(ctx, zone, enemy);
      }
      return;
    case "aura":
      if (!ctx.auraPulse) return;
      for (const enemy of enemies) {
        if (overlaps(zone, enemy)) land(ctx, zone, enemy);
      }
      return;
    case "puddle":
      if (!isDue(zone.pulse ?? 0)) return;
      zone.pulse = pulseInterval(zone.weapon);
      for (const enemy of enemies) {
        if (overlaps(zone, enemy)) land(ctx, zone, enemy);
      }
      return;
    case "lantern":
      for (const enemy of enemies) {
        if (overlaps(zone, enemy)) touch(ctx, zone, enemy, LANTERN_REHIT);
      }
      return;
  }
}

/** The third part of phase 6: every projectile and zone hits. */
export function resolveHits(ctx: TickContext): void {
  const { run } = ctx;
  const enemies = run.enemies.slice().sort((a, b) => a.id - b.id);
  run.projectiles = run.projectiles.filter((projectile) =>
    projectileHits(ctx, projectile, enemies),
  );
  for (const zone of run.zones) zoneHits(ctx, zone, enemies);
}
