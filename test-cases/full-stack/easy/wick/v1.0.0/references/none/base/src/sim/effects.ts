// Wick — projectiles and zones through a tick (specs/world.md "One tick"
// phase 6, specs/weapons.md "Projectiles and pierce", "Hits and death").

import {
  BREAD_CHANCE,
  CUES,
  DRAFT_CHANCE,
  ENEMIES,
  TICK_DT,
} from "../constants";
import type { Enemy, Projectile, Zone } from "../state";
import type { TickContext } from "./context";
import { countDown, isDue } from "./timers";

/** Whether a shape was created before this tick. */
function existedBefore(shape: { bornTick: number }, tick: number): boolean {
  return shape.bornTick < tick;
}

/**
 * The first part of phase 6: every projectile and zone that existed before
 * this tick counts its `ttl` down and is removed when it is due, and every
 * re-hit entry counts down.
 */
export function expireEffects(ctx: TickContext): void {
  const { run } = ctx;
  const keepProjectile = (projectile: Projectile): boolean => {
    if (!existedBefore(projectile, run.tick)) return true;
    projectile.ttl = countDown(projectile.ttl);
    for (const hit of projectile.hits) hit.cooldown = countDown(hit.cooldown);
    return !isDue(projectile.ttl);
  };
  const keepZone = (zone: Zone): boolean => {
    if (!existedBefore(zone, run.tick)) return true;
    for (const hit of zone.hits) hit.cooldown = countDown(hit.cooldown);
    if (zone.ttl === null) return true;
    zone.ttl = countDown(zone.ttl);
    return !isDue(zone.ttl);
  };
  run.projectiles = run.projectiles.filter(keepProjectile);
  run.zones = run.zones.filter(keepZone);
}

/**
 * The second part of phase 6, while `effectMotion` is on: every remaining
 * projectile that existed before this tick advances by its velocity, then
 * its velocity changes by its acceleration.
 */
export function moveEffects(ctx: TickContext): void {
  const { run } = ctx;
  for (const projectile of run.projectiles) {
    if (!existedBefore(projectile, run.tick)) continue;
    projectile.x += projectile.vx * TICK_DT;
    projectile.y += projectile.vy * TICK_DT;
    projectile.vx += projectile.ax * TICK_DT;
    projectile.vy += projectile.ay * TICK_DT;
  }
}

/** The third part of phase 6: every projectile and zone hits. */
export function resolveHits(_ctx: TickContext): void {}

/**
 * The last part of phase 6: an enemy whose `hp` is at or below `0` dies. The
 * kill count rises, its drop lands at its center, a common kill draws for
 * bread and a draft, and a puff is left to draw.
 */
export function resolveDeaths(ctx: TickContext): void {
  const { run } = ctx;
  const survivors: Enemy[] = [];
  for (const enemy of run.enemies) {
    if (enemy.hp > 0) {
      survivors.push(enemy);
      continue;
    }
    run.kills += 1;
    ctx.cues.add(CUES.kill);
    run.puffs.push({ x: enemy.x, y: enemy.y, bornTick: run.tick });
    const def = ENEMIES[enemy.type];
    if (def.rank === "elite") {
      run.pickups.push({
        id: run.nextId,
        kind: "chest",
        x: enemy.x,
        y: enemy.y,
      });
      run.nextId += 1;
    } else if (def.gem !== null) {
      run.gems.push({
        id: run.nextId,
        tier: def.gem,
        x: enemy.x,
        y: enemy.y,
        attracted: false,
        bornTick: run.tick,
      });
      run.nextId += 1;
      if (ctx.rng.next() < BREAD_CHANCE) {
        run.pickups.push({
          id: run.nextId,
          kind: "bread",
          x: enemy.x,
          y: enemy.y,
        });
        run.nextId += 1;
      } else if (ctx.rng.next() < DRAFT_CHANCE) {
        run.pickups.push({
          id: run.nextId,
          kind: "draft",
          x: enemy.x,
          y: enemy.y,
        });
        run.nextId += 1;
      }
    }
  }
  run.enemies = survivors;
}
