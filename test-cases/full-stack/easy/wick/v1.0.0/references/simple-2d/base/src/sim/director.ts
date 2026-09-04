// Wick — the spawn director, phase 10 of the tick (specs/enemies.md "The
// spawn director").
//
// Three parts, each behind its own driver switch: despawning by distance
// while `despawning` is on, the scripted events while `events` is on, and
// the window spawn timer while `spawning` is on. Every random figure, the
// spawn angle, the type choice, and a swarm's direction, is drawn from the
// seeded generator; a window spawn draws its type first and its angle second.

import {
  DESPAWN_DISTANCE,
  ENEMIES,
  EVENTS,
  SPAWN_DISTANCE,
  SPAWN_WINDOWS,
  SWARM_LINE,
  SWARM_SIZE,
  TICK_HZ,
  type EnemyId,
  type ScriptedEvent,
} from "../constants";
import type { DraftRun } from "../state";
import type { TickContext } from "./context";
import { forgetHits } from "./effects";
import { aliveCommons, spawnEnemy, spawnWindow, windowOfTick } from "./enemies";
import { distance, type Vec } from "./geometry";
import { countDown, isDue } from "./timers";

/** A point `SPAWN_DISTANCE` from the lamplighter along the unit vector `d`. */
function ringPoint(run: DraftRun, d: Vec): Vec {
  return {
    x: run.player.x + d.x * SPAWN_DISTANCE,
    y: run.player.y + d.y * SPAWN_DISTANCE,
  };
}

/** A unit vector at an angle drawn uniformly from the generator. */
function randomDirection(ctx: TickContext): Vec {
  const angle = ctx.rng.next() * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Spawn one enemy of `type` at a spawn point on the ring. */
function spawnOnRing(ctx: TickContext, type: EnemyId): void {
  const at = ringPoint(ctx.run, randomDirection(ctx));
  spawnEnemy(ctx.run, type, at.x, at.y);
}

/**
 * A swarm: `SWARM_SIZE` of `type` on one tick along a line of `SWARM_LINE`
 * units perpendicular to a random direction `d`, centered `SPAWN_DISTANCE`
 * along `d`, evenly spaced with one at each end, every one heading `-d`.
 */
function spawnSwarm(ctx: TickContext, type: EnemyId): void {
  const { run } = ctx;
  const d = randomDirection(ctx);
  const center = ringPoint(run, d);
  const perp = { x: -d.y, y: d.x };
  const spacing = SWARM_LINE / (SWARM_SIZE - 1);
  const heading = { x: -d.x, y: -d.y };
  for (let i = 0; i < SWARM_SIZE; i += 1) {
    const along = (i - (SWARM_SIZE - 1) / 2) * spacing;
    spawnEnemy(
      run,
      type,
      center.x + perp.x * along,
      center.y + perp.y * along,
      heading,
    );
  }
}

/** Fire one scripted event. */
function fireEvent(ctx: TickContext, event: ScriptedEvent): void {
  switch (event.kind) {
    case "swarm":
      spawnSwarm(ctx, event.type);
      return;
    case "spawn":
      spawnOnRing(ctx, event.type);
      return;
  }
}

/**
 * Despawning: every common enemy farther than `DESPAWN_DISTANCE` from the
 * lamplighter's center is removed, with no gem, no kill, and no cue. Elites
 * and the Dark stay at any distance.
 */
export function despawnFarCommons(run: DraftRun): void {
  const gone = new Set<number>();
  run.enemies = run.enemies.filter((enemy) => {
    const far =
      ENEMIES[enemy.type].rank === "common" &&
      distance(enemy, run.player) > DESPAWN_DISTANCE;
    if (far) gone.add(enemy.id);
    return !far;
  });
  if (gone.size > 0) forgetHits(run, gone);
}

/**
 * The scripted events: each fires once per run, on exactly the tick the run
 * clock equals its time, and `firedEvents` records the times, ascending.
 */
export function fireDueEvents(ctx: TickContext): void {
  const { run } = ctx;
  for (const event of EVENTS) {
    if (event.time * TICK_HZ !== run.tick) continue;
    if (run.firedEvents.includes(event.time)) continue;
    fireEvent(ctx, event);
    run.firedEvents.push(event.time);
    run.firedEvents.sort((a, b) => a - b);
  }
}

/**
 * The spawn timer: it resets on the first tick of a new window, counts
 * down, and, when due with room under the cap, spawns one enemy of a type
 * chosen uniformly from the window's types at a spawn point and is set to
 * the window's interval. When the cap is full it rests at `0`.
 */
export function runSpawnTimer(ctx: TickContext): void {
  const { run } = ctx;
  const window = spawnWindow(run);
  if (window !== windowOfTick(run.tick - 1)) run.spawnTimer = 0;
  run.spawnTimer = countDown(run.spawnTimer);
  const row = SPAWN_WINDOWS[window];
  if (!isDue(run.spawnTimer) || aliveCommons(run) >= row.cap) return;
  const type = ctx.rng.pick(row.types);
  spawnOnRing(ctx, type);
  run.spawnTimer = row.interval;
}

/** Phase 10: the spawn director, its three parts each behind a switch. */
export function runDirector(ctx: TickContext): void {
  const { state } = ctx;
  if (state.despawning) despawnFarCommons(ctx.run);
  if (state.events) fireDueEvents(ctx);
  if (state.spawning) runSpawnTimer(ctx);
}
