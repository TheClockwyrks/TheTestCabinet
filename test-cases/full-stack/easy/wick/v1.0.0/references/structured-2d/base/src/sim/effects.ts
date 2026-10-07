// Wick — projectiles and zones through a tick (specs/world.md "One tick"
// phase 6, specs/weapons.md "Projectiles and pierce", "Lantern", "Shard",
// "Hits and death"). The hits themselves are `hits.ts`.

import {
  BREAD_CHANCE,
  CUES,
  DRAFT_CHANCE,
  ENEMIES,
  LANTERN_ANGULAR_SPEED,
  STAGE_CX,
  STAGE_CY,
  TICK_DT,
} from "../constants";
import type {
  EnemyState,
  ProjectileState,
  RunState,
  ZoneState,
} from "../state";
import type { Rng } from "../rng";
import type { TickContext } from "./context";
import { countDown, isDue } from "./timers";
import { placeLantern } from "./weapons";

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
  const keepProjectile = (projectile: ProjectileState): boolean => {
    if (!existedBefore(projectile, run.tick)) return true;
    projectile.ttl = countDown(projectile.ttl);
    for (const hit of projectile.hits) hit.cooldown = countDown(hit.cooldown);
    return !isDue(projectile.ttl);
  };
  const keepZone = (zone: ZoneState): boolean => {
    if (!existedBefore(zone, run.tick)) return true;
    for (const hit of zone.hits) hit.cooldown = countDown(hit.cooldown);
    if (zone.pulse !== undefined) zone.pulse = countDown(zone.pulse);
    if (zone.ttl === null) return true;
    zone.ttl = countDown(zone.ttl);
    return !isDue(zone.ttl);
  };
  run.projectiles = run.projectiles.filter(keepProjectile);
  run.zones = run.zones.filter(keepZone);
}

/**
 * A shard stays inside the view, the stage rectangle centered on the
 * lamplighter: a center carried past an edge is clamped to it, and the
 * velocity component across that edge reverses when it points outward.
 */
function bounce(run: RunState, shard: ProjectileState): void {
  const left = run.player.x - STAGE_CX;
  const right = run.player.x + STAGE_CX;
  const top = run.player.y - STAGE_CY;
  const bottom = run.player.y + STAGE_CY;
  if (shard.x < left) {
    shard.x = left;
    if (shard.vx < 0) shard.vx = -shard.vx;
  } else if (shard.x > right) {
    shard.x = right;
    if (shard.vx > 0) shard.vx = -shard.vx;
  }
  if (shard.y < top) {
    shard.y = top;
    if (shard.vy < 0) shard.vy = -shard.vy;
  } else if (shard.y > bottom) {
    shard.y = bottom;
    if (shard.vy > 0) shard.vy = -shard.vy;
  }
}

/**
 * The second part of phase 6, while `effectMotion` is on: every remaining
 * projectile that existed before this tick advances by its velocity, then
 * its velocity changes by its acceleration; a shard bounces off the view's
 * edges; and every lantern that existed before this tick revolves.
 */
export function moveEffects(ctx: TickContext): void {
  const { run } = ctx;
  for (const projectile of run.projectiles) {
    if (!existedBefore(projectile, run.tick)) continue;
    projectile.x += projectile.vx * TICK_DT;
    projectile.y += projectile.vy * TICK_DT;
    projectile.vx += projectile.ax * TICK_DT;
    projectile.vy += projectile.ay * TICK_DT;
    if (projectile.weapon === "shard") bounce(run, projectile);
  }
  for (const zone of run.zones) {
    if (zone.kind !== "lantern" || !existedBefore(zone, run.tick)) continue;
    zone.angle = (zone.angle ?? 0) + LANTERN_ANGULAR_SPEED * TICK_DT;
    placeLantern(run, zone);
  }
}

/** Forget the re-hit entries of enemies that are gone. */
export function forgetHits(run: RunState, dead: ReadonlySet<number>): void {
  const keep = (hit: { enemy: number }): boolean => !dead.has(hit.enemy);
  for (const projectile of run.projectiles) {
    projectile.hits = projectile.hits.filter(keep);
  }
  for (const zone of run.zones) zone.hits = zone.hits.filter(keep);
}

/**
 * One drop roll of specs/world.md, drawn from `rng`: bread with probability
 * `BREAD_CHANCE`, and only when no bread dropped a draft with probability
 * `DRAFT_CHANCE`. The surface's `rollDrop` makes this roll alone.
 */
export function drawDrop(rng: Rng): "bread" | "draft" | "none" {
  if (rng.next() < BREAD_CHANCE) return "bread";
  if (rng.next() < DRAFT_CHANCE) return "draft";
  return "none";
}

/**
 * What a common kill drops: the posed `nextDrop` when one stands, consumed
 * here; otherwise the drop roll.
 */
function rollDrop(ctx: TickContext): "bread" | "draft" | "none" {
  const posed = ctx.run.nextDrop;
  if (posed !== null) {
    ctx.run.nextDrop = null;
    return posed;
  }
  return drawDrop(ctx.rng);
}

/**
 * The last part of phase 6: an enemy whose `hp` is at or below `0` dies. The
 * kill count rises, and a puff is left to draw; while `drops` is on its drop
 * lands at its center and a common kill rolls for a pickup.
 */
export function resolveDeaths(ctx: TickContext): void {
  const { run } = ctx;
  const survivors: EnemyState[] = [];
  const dead = new Set<number>();
  for (const enemy of run.enemies) {
    if (enemy.hp > 0) {
      survivors.push(enemy);
      continue;
    }
    dead.add(enemy.id);
    run.kills += 1;
    ctx.cues.add(CUES.kill);
    run.puffs.push({ x: enemy.x, y: enemy.y, bornTick: run.tick });
    // The `drops` switch gates what a death LEAVES, not the death itself: the
    // kill still counts, the cue still sounds, and no roll is made.
    if (!ctx.state.drops) continue;
    const def = ENEMIES[enemy.type];
    if (def.drop === "chest") {
      run.pickups.push({
        id: run.nextId,
        kind: "chest",
        x: enemy.x,
        y: enemy.y,
      });
      run.nextId += 1;
    } else if (def.drop !== null) {
      run.gems.push({
        id: run.nextId,
        tier: def.drop,
        x: enemy.x,
        y: enemy.y,
        attracted: false,
        bornTick: run.tick,
      });
      run.nextId += 1;
      const dropped = rollDrop(ctx);
      if (dropped !== "none") {
        run.pickups.push({
          id: run.nextId,
          kind: dropped,
          x: enemy.x,
          y: enemy.y,
        });
        run.nextId += 1;
      }
    }
  }
  run.enemies = survivors;
  if (dead.size > 0) forgetHits(run, dead);
}
