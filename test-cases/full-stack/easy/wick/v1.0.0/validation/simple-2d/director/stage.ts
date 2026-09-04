// director/stage — how every check in this directory poses the night, and the
// readings they share.
//
// THE THREE FACULTIES. specs/enemies.md ("The spawn director"): the director
// "runs on every tick of the `playing` screen, in three parts that the driver
// switches `specs/instrumentation.md` defines gate one each: despawning runs
// while `despawning` is on, the scripted events fire while `events` is on, and
// the spawn timer counts and spawns while `spawning` is on". Every check here
// opens with `isolate`, an empty `playing` run with all nine switches off, and
// turns on the one switch its requirement is about, so nothing arrives, moves,
// hits, or fires except the thing under test.
//
// WHY THE FIELD IS CLEARED BETWEEN SPAWNS. A window's row carries a cap, and a
// check about the row's interval or its types must not run into it: the field
// is emptied after each spawn is read, so the cap is never the reason a spawn
// did or did not land, and each spawn is read alone on the tick it appeared.
// The cap is a requirement of its own, posed deliberately by `poseRing`.
//
// Every figure here comes from `../constants`, which restates the specification;
// the two positions this file chooses for itself (the ring a posed crowd stands
// on, and the margin a sweep allows) are named and are not assertions.

import {
  SPAWN_WINDOW,
  SPAWN_WINDOWS,
  TICK_HZ,
  ticksFor,
  type EnemyId,
} from "../constants";
import {
  enable,
  setSwitch,
  spawnEnemyAt,
  type EnemySnapshot,
  type Harness,
  type Point,
  type WickSnapshot,
} from "../harness";

/* ------------------------------- Windows ---------------------------------- */

/** specs/enemies.md ("Windows"): "windows of `SPAWN_WINDOW` (`30`) seconds". */
export const WINDOW_TICKS = SPAWN_WINDOW * TICK_HZ;

/** The first tick of window `index`, the tick its row starts applying on. */
export function windowStartTick(index: number): number {
  return index * WINDOW_TICKS;
}

/**
 * Window `index`'s interval as a whole count of ticks: "An interval of `s`
 * seconds anywhere in this specification is likewise `round(s × TICK_HZ)`
 * ticks" (specs/world.md, "Timers").
 */
export function windowIntervalTicks(index: number): number {
  return ticksFor(SPAWN_WINDOWS[index].interval);
}

/**
 * Pose the clock into window `index` with the spawn timer resting at `0`.
 *
 * `setTick` alone "changes the timer on no tick of its own"
 * (specs/enemies.md, "The spawn timer"), so the timer is posed as well, and a
 * timer at `0` "stays due on every tick until it is set again"
 * (specs/world.md, "Timers"): the next tick spawns, and the row's interval is
 * read from the ticks between the spawns that follow.
 */
export function poseWindow(h: Harness, index: number): void {
  h.debug.setTick(windowStartTick(index));
  h.debug.setSpawnTimer(0);
}

/* ------------------------------- Spawns ----------------------------------- */

/** One spawn as it was read on the tick it landed. */
export interface Spawn {
  /** The tick the enemy first appeared on. */
  tick: number;
  type: EnemyId;
  id: number;
  x: number;
  y: number;
  /** Where the lamplighter stood on that tick. */
  player: Point;
}

/**
 * Drive one tick at a time until `want` spawns have landed or `budget` ticks
 * are spent, reading each spawn on the tick it appeared and emptying the field
 * after it.
 *
 * What comes back is every enemy that appeared, in the order it appeared, so a
 * check reads the ticks between spawns, the types chosen, and where each one
 * landed relative to the lamplighter of that tick.
 */
export async function collectSpawns(
  h: Harness,
  want: number,
  budget: number,
): Promise<Spawn[]> {
  const spawns: Spawn[] = [];
  for (let driven = 0; driven < budget && spawns.length < want; driven += 1) {
    const s = await h.tick(1);
    if (s.run.enemies.length === 0) continue;
    for (const enemy of s.run.enemies) {
      spawns.push({
        tick: s.run.tick,
        type: enemy.type,
        id: enemy.id,
        x: enemy.x,
        y: enemy.y,
        player: { x: s.run.player.x, y: s.run.player.y },
      });
    }
    h.debug.clearEnemies();
  }
  return spawns;
}

/** The ticks between consecutive spawns, in order. */
export function spawnGaps(spawns: readonly Spawn[]): number[] {
  return spawns.slice(1).map((spawn, i) => spawn.tick - spawns[i].tick);
}

/** The distinct types across `spawns`, in the order they were first drawn. */
export function spawnTypes(spawns: readonly Spawn[]): EnemyId[] {
  return [...new Set(spawns.map((spawn) => spawn.type))];
}

/* --------------------------- A posed crowd -------------------------------- */

/**
 * Where a posed crowd stands: 300 units from the lamplighter, well inside
 * `DESPAWN_DISTANCE` (1200) so no check about the cap is decided by a removal,
 * and far enough out that nothing overlaps the lamplighter. The scenarios that
 * use it hold `enemyMotion`, `enemyContact`, and `despawning` off, so the crowd
 * is inert whatever it stands on.
 */
const POSED_RING = 300;

/**
 * Place `count` enemies of `type` evenly around the lamplighter and answer
 * their ids, in the order they were placed.
 *
 * `spawnEnemy` puts each one on the field "through the real spawn path"
 * (specs/instrumentation.md), so a posed crowd counts against the cap exactly
 * as a director spawn does.
 */
export function poseRing(
  h: Harness,
  type: EnemyId,
  count: number,
  radius = POSED_RING,
): number[] {
  const { player } = h.snapshot().run;
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / Math.max(1, count);
    ids.push(
      spawnEnemyAt(
        h,
        type,
        player.x + Math.cos(angle) * radius,
        player.y + Math.sin(angle) * radius,
      ),
    );
  }
  return ids;
}

/* ----------------------------- The events --------------------------------- */

/**
 * The tick a scripted event at `seconds` fires on: "on exactly the tick the run
 * clock equals its time (`tick == time * TICK_HZ`, read after the tick's clock
 * has risen)" (specs/enemies.md, "Scripted events").
 */
export function eventTick(seconds: number): number {
  return seconds * TICK_HZ;
}

/** The tick before an event's, and the event's own tick. */
export interface EventPair {
  before: WickSnapshot;
  on: WickSnapshot;
}

/**
 * Carry the clock across the tick the event at `seconds` fires on, and read
 * both the tick before it and the tick itself.
 *
 * The clock is posed two ticks short of the event, so the first tick driven is
 * the one before the event and the second is the event's own: the pair is what
 * decides "on that tick and not the one before". Nothing is posed on the event
 * itself, so what fires comes from the tick.
 */
export async function crossEvent(
  h: Harness,
  seconds: number,
): Promise<EventPair> {
  h.debug.setTick(eventTick(seconds) - 2);
  const before = await h.tick(1);
  const on = await h.tick(1);
  return { before, on };
}

/** Every enemy of `type` on the field, in the order the snapshot lists them. */
export function enemiesOfType(
  snapshot: WickSnapshot,
  type: EnemyId,
): EnemySnapshot[] {
  return snapshot.run.enemies.filter((enemy) => enemy.type === type);
}

/* ------------------------------ The swarm --------------------------------- */

/**
 * The direction `d` a swarm was drawn along, recovered from the line itself.
 *
 * specs/enemies.md ("Scripted events") places gnat `i` at
 * `center + perp * (i - (SWARM_SIZE - 1) / 2) * spacing` about
 * `center = player + d * SPAWN_DISTANCE`, and those offsets sum to zero over
 * the whole line, so the gnats' centroid is the center and the unit vector
 * from the lamplighter to it is `d`. The angle itself is "drawn uniformly from
 * the seeded generator", so no check may expect a particular one.
 */
export function swarmDirection(
  gnats: readonly EnemySnapshot[],
  player: Point,
): Point {
  const center = swarmCenter(gnats);
  const dx = center.x - player.x;
  const dy = center.y - player.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
}

/** The centroid of the gnats' positions: the line's center. */
export function swarmCenter(gnats: readonly EnemySnapshot[]): Point {
  const sum = gnats.reduce(
    (total, gnat) => ({ x: total.x + gnat.x, y: total.y + gnat.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / gnats.length, y: sum.y / gnats.length };
}

/* ------------------------------ The evidence ------------------------------ */

/**
 * How long the closing drift runs: four seconds, far enough that a moth at 100
 * units a second covers 400 of the 760 it spawned at and stands inside the
 * `STAGE_W x STAGE_H` view the still is taken of.
 */
const CLOSING_TICKS = 240;

/**
 * Let what the director spawned travel toward the lamplighter, for the picture
 * alone.
 *
 * The director places what it spawns `SPAWN_DISTANCE` (760) units out, beyond
 * the half-width of the view, so a still taken on the spawn tick shows an empty
 * field. This drive brings what arrived into the view before the picture is
 * kept. Nothing here can change a verdict: every reading an item asserts is
 * taken before the call, and anything the drive raises is reported and
 * swallowed, so a build that cannot move its enemies fails the items about
 * moving enemies and not this one. `enemyMotion` is left as the caller had it,
 * so a scenario that goes on to read something after the picture reads it under
 * the faculties it posed.
 */
export async function closeIn(
  h: Harness,
  ticks = CLOSING_TICKS,
): Promise<void> {
  const motion = h.snapshot().enemyMotion;
  enable(h, "enemyMotion");
  try {
    await h.tick(ticks);
  } catch (error) {
    console.warn(`wick: the closing drift raised ${String(error)}`);
  } finally {
    setSwitch(h, "enemyMotion", motion);
  }
}
