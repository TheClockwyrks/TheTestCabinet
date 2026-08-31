// Wick — the enemies (specs/enemies.md).
//
// How an enemy comes into the world, the figures the director reads (the
// window index, the count against the cap, the health scaling), and phase 4
// of the tick: every enemy ages, and, while `enemyMotion` is on, moves as
// its behavior states. The director itself is `director.ts`.

import {
  ENEMIES,
  ENEMY_IDS,
  HP_SCALE_PER_MINUTE,
  SPAWN_WINDOW,
  SPAWN_WINDOWS,
  TICK_DT,
  TICK_HZ,
  WISP_AMPLITUDE,
  WISP_PERIOD,
  type Enemy,
  type EnemyId,
} from "../constants";
import type { EnemyState, RunState } from "../state";
import type { TickContext } from "./context";
import { direction, type Vec } from "./geometry";

export function isEnemyId(id: string): id is EnemyId {
  return (ENEMY_IDS as readonly string[]).includes(id);
}

/** The run clock, in seconds. */
export function runTime(run: RunState): number {
  return run.tick / TICK_HZ;
}

/** The last window's index; its row runs until dawn. */
export const LAST_WINDOW = SPAWN_WINDOWS.length - 1;

/** The spawn window a tick falls in. */
export function windowOfTick(tick: number): number {
  return Math.min(LAST_WINDOW, Math.floor(tick / TICK_HZ / SPAWN_WINDOW));
}

/** The current spawn window's index. */
export function spawnWindow(run: RunState): number {
  return windowOfTick(run.tick);
}

/** Whether an enemy counts against the cap: a common other than a gnat. */
export function countsAgainstCap(type: EnemyId): boolean {
  return ENEMIES[type].rank === "common" && type !== "gnat";
}

/** How many live commons other than gnats count against the cap. */
export function aliveCommons(run: RunState): number {
  return run.enemies.filter((enemy) => countsAgainstCap(enemy.type)).length;
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
): EnemyState {
  const def = ENEMIES[type];
  const scale = def.rank === "common" ? hpMul(runTime(run)) : 1;
  const enemy: EnemyState = {
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

// ---- Movement --------------------------------------------------------------

/** The heading rotated +90 degrees. */
function perpendicular(heading: Vec): Vec {
  return { x: -heading.y, y: heading.x };
}

/** A weaver's sideways offset from its anchor at `age`. */
export function weaveOffset(age: number): number {
  return WISP_AMPLITUDE * Math.sin((2 * Math.PI * age) / WISP_PERIOD);
}

/** One step of `def.speed` along `heading`. */
function advance(at: Vec, heading: Vec, def: Enemy): void {
  at.x += heading.x * def.speed * TICK_DT;
  at.y += heading.y * def.speed * TICK_DT;
}

/**
 * A chaser recomputes its heading toward the lamplighter's center and
 * advances one step; one whose center coincides with it holds.
 */
function chase(run: RunState, enemy: EnemyState, def: Enemy): void {
  const heading = direction(enemy, run.player);
  if (heading === null) return;
  enemy.heading = heading;
  advance(enemy, heading, def);
}

/** A drifter advances one step along the heading it spawned with. */
function drift(enemy: EnemyState, def: Enemy): void {
  advance(enemy, enemy.heading, def);
}

/**
 * A weaver's anchor chases the lamplighter, and its position is the anchor
 * plus a perpendicular offset that swings with age. The anchor is recovered
 * from the position at the age before this tick, advanced, and the position
 * rebuilt at the age after it. An anchor coinciding with the lamplighter's
 * center holds the heading and the position; the age still counts.
 */
function weave(run: RunState, enemy: EnemyState, def: Enemy): void {
  const before = perpendicular(enemy.heading);
  const offset = weaveOffset(enemy.age);
  const anchor = {
    x: enemy.x - before.x * offset,
    y: enemy.y - before.y * offset,
  };
  const heading = direction(anchor, run.player);
  enemy.age += TICK_DT;
  if (heading === null) return;
  advance(anchor, heading, def);
  enemy.heading = heading;
  const after = perpendicular(heading);
  const swung = weaveOffset(enemy.age);
  enemy.x = anchor.x + after.x * swung;
  enemy.y = anchor.y + after.y * swung;
}

/** One tick of one enemy: it ages and moves as its behavior states. */
export function stepEnemy(run: RunState, enemy: EnemyState): void {
  const def = ENEMIES[enemy.type];
  switch (def.behavior) {
    case "chase":
      enemy.age += TICK_DT;
      chase(run, enemy, def);
      return;
    case "drift":
      enemy.age += TICK_DT;
      drift(enemy, def);
      return;
    case "weave":
      weave(run, enemy, def);
      return;
  }
}

/** Phase 4: every enemy ages, and, while `enemyMotion` is on, moves. */
export function ageAndMoveEnemies(ctx: TickContext): void {
  const { run, state } = ctx;
  for (const enemy of run.enemies) {
    if (state.enemyMotion) stepEnemy(run, enemy);
    else enemy.age += TICK_DT;
  }
}
