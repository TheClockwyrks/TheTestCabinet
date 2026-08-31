// Wick — the enemies (specs/enemies.md).
//
// How an enemy comes into the world, how it ages, and the figures the
// director reads: the window index, the count against the cap, and the health
// scaling. The movement behaviors and the director itself are phases 4 and
// 10 of the tick.

import {
  ENEMIES,
  HP_SCALE_PER_MINUTE,
  LAST_WINDOW,
  SPAWN_WINDOW,
  TICK_DT,
  TICK_HZ,
  type EnemyId,
  ENEMY_IDS,
} from "../constants";
import type { Enemy, RunState } from "../state";
import type { TickContext } from "./context";
import { direction, type Vec } from "./geometry";

export function isEnemyId(id: string): id is EnemyId {
  return (ENEMY_IDS as readonly string[]).includes(id);
}

/** The run clock, in seconds. */
export function runTime(run: RunState): number {
  return run.tick / TICK_HZ;
}

/** The current spawn window's index. */
export function spawnWindow(run: RunState): number {
  return Math.min(LAST_WINDOW, Math.floor(runTime(run) / SPAWN_WINDOW));
}

/** How many live commons other than gnats count against the cap. */
export function aliveCommons(run: RunState): number {
  return run.enemies.filter(
    (enemy) => ENEMIES[enemy.type].rank === "common" && enemy.type !== "gnat",
  ).length;
}

/** The health multiplier a common enemy spawning at `time` takes. */
export function hpMul(time: number): number {
  return 1 + HP_SCALE_PER_MINUTE * Math.floor(time / 60);
}

/** The facing direction as a unit vector. */
export function facingVector(run: RunState): Vec {
  return { x: run.player.facing === "left" ? -1 : 1, y: 0 };
}

/**
 * The heading a spawn at `at` takes: the unit vector toward the lamplighter's
 * center, or the facing direction when the two coincide.
 */
export function spawnHeading(run: RunState, at: Vec): Vec {
  return direction(at, run.player) ?? facingVector(run);
}

/**
 * Spawn one enemy of `type` at `(x, y)` through the real spawn path: the next
 * id, `maxHp` scaled by the run clock for a common, `age` and
 * `contactCooldown` at `0`, and the heading a spawn at that point takes
 * unless `heading` is given.
 */
export function spawnEnemy(
  run: RunState,
  type: EnemyId,
  x: number,
  y: number,
  heading?: Vec,
): Enemy {
  const def = ENEMIES[type];
  const scale = def.rank === "common" ? hpMul(runTime(run)) : 1;
  const enemy: Enemy = {
    id: run.nextId,
    type,
    x,
    y,
    hp: def.hp * scale,
    maxHp: def.hp * scale,
    heading: heading ?? spawnHeading(run, { x, y }),
    age: 0,
    contactCooldown: 0,
  };
  run.nextId += 1;
  run.enemies.push(enemy);
  return enemy;
}

/** Phase 4: every enemy ages, and, while `enemyMotion` is on, moves. */
export function ageAndMoveEnemies(ctx: TickContext): void {
  for (const enemy of ctx.run.enemies) enemy.age += TICK_DT;
  if (ctx.state.switches.enemyMotion) moveEnemies(ctx);
}

/** Every enemy advances one step as its behavior states. */
export function moveEnemies(_ctx: TickContext): void {}

/**
 * Phase 10: the spawn director. Despawning while `despawning` is on, the
 * scripted events while `events` is on, then the spawn timer while
 * `spawning` is on.
 */
export function runDirector(_ctx: TickContext): void {}
