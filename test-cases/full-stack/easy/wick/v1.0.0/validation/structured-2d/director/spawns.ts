// director/spawns — the arrangements and the readings the director's checks
// share.
//
// WHAT THE DIRECTOR NEEDS THAT THE HARNESS DOES NOT ALREADY GIVE. Every check
// here watches something ARRIVE: the tick a spawn landed on, which type it
// was, and where it stood on the tick it appeared. `specs/world.md` ("One
// tick", phase 10) puts the director last in a tick and says "An enemy
// spawned on this tick sits at its spawn point and first moves on the next
// tick", so the spawn point is legible in exactly one snapshot — the one taken
// at the end of the tick the enemy appeared on. A drive that ran several ticks
// and looked afterwards would have lost it. So the drives below step ONE tick
// at a time and read the snapshot after each, and an arrival carries the tick,
// the enemy as it stood on that tick, and the lamplighter's center at that
// moment.
//
// WHAT IS ARRANGED, AND WHAT IS NOT. Nothing here turns a driver switch on:
// each check enables exactly the part of the director its requirement is about
// (`spawning`, `events`, or `despawning`) over the isolated world `isolate`
// poses, in which every switch is off and nothing is alive. The poses below
// place enemies and move the clock, which is all the cap and window scenarios
// need.
//
// Every figure this module chooses for itself — where a posed common stands,
// how far apart the ring poses the lamplighter — is named here; every figure
// the specification states is imported from `../constants`.

import { fail } from "../assert";
import {
  SPAWN_WINDOW,
  SPAWN_WINDOWS,
  TICK_HZ,
  type EnemyId,
} from "../constants";
import {
  placeEnemy,
  pointAt,
  unit,
  type Harness,
  type Point,
  type SnapshotEnemy,
  type WickSnapshot,
} from "../harness";

/** One enemy's arrival: the tick it first appeared on, and the world then. */
export interface Arrival {
  /** `run.tick` of the snapshot the enemy first appeared in. */
  tick: number;
  /** The enemy exactly as that snapshot reported it, at its spawn point. */
  enemy: SnapshotEnemy;
  /** The lamplighter's center on that same tick. */
  player: Point;
}

/** What a tick-by-tick drive saw: every arrival, and the state it ended at. */
export interface Drive {
  arrivals: Arrival[];
  /** The snapshot after the last tick driven. */
  snapshot: WickSnapshot;
  /** How many ticks were driven. */
  ticks: number;
}

/** Whether a drive clears each arrival away as it lands. */
export interface DriveOptions {
  /**
   * Remove every enemy that arrives, on the tick it arrived, through
   * `removeEnemy` — which "Removes enemy `id`. Nothing drops, nothing counts
   * as a kill, and no cue plays" (`specs/instrumentation.md`). A check that
   * wants many window spawns in a row needs it: `aliveCommons` would
   * otherwise reach the window's cap and the director would stop
   * (`specs/enemies.md`, "The cap").
   */
  removeOnArrival?: boolean;
  /** Stop once this many arrivals have been seen. */
  stopAfter?: number;
}

/** The ids of every enemy a snapshot holds. */
function idsOf(snapshot: WickSnapshot): Set<number> {
  return new Set(snapshot.run.enemies.map((enemy) => enemy.id));
}

/**
 * Drive at most `ticks` whole ticks, one at a time, recording every enemy that
 * appeared and on which tick.
 *
 * The drive stops early once `stopAfter` arrivals have landed, so a check that
 * wants thirty spawns says how many rather than how long.
 */
export async function driveArrivals(
  h: Harness,
  ticks: number,
  options: DriveOptions = {},
): Promise<Drive> {
  const { removeOnArrival = false, stopAfter } = options;
  const seen = idsOf(h.snapshot());
  const arrivals: Arrival[] = [];
  let snapshot = h.snapshot();
  let driven = 0;
  for (let step = 0; step < ticks; step += 1) {
    await h.advance(1);
    snapshot = h.snapshot();
    driven += 1;
    for (const enemy of snapshot.run.enemies) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      arrivals.push({
        tick: snapshot.run.tick,
        enemy,
        player: { x: snapshot.run.player.x, y: snapshot.run.player.y },
      });
      if (removeOnArrival) h.debug.removeEnemy(enemy.id);
    }
    if (removeOnArrival) snapshot = h.snapshot();
    if (stopAfter !== undefined && arrivals.length >= stopAfter) break;
  }
  return { arrivals, snapshot, ticks: driven };
}

/**
 * How many spawns a window's cadence is read over: the spawn a posed timer of
 * `0` lands at once and one more at the end of each of two whole intervals.
 */
export const CADENCE_SPAWNS = 3;

/** How many window spawns a type reading draws with nothing posed. */
export const UNPOSED_DRAWS = 6;

/**
 * Draw `count` window spawns one to a tick, each posed by setting the timer to
 * `0` so the next tick spawns and cleared away as it lands, and answer each
 * arrival in order, read on the tick it landed.
 *
 * The cap never binds, since nothing is left standing, and every draw is the
 * window's own: the type "chosen uniformly from the window's types" and the
 * angle "drawn uniformly over the full circle" (`specs/enemies.md`, "The
 * spawn timer" and "The spawn ring"). Each draw costs one tick whatever the
 * window's interval, so a reading over many draws finishes in seconds.
 */
export async function drawSpawns(
  h: Harness,
  count: number,
): Promise<Arrival[]> {
  const spawns: Arrival[] = [];
  for (let draw = 0; draw < count; draw += 1) {
    h.debug.setSpawnTimer(0);
    const drive = await driveArrivals(h, 1, { removeOnArrival: true });
    if (drive.arrivals.length !== 1) {
      fail(
        `one enemy spawned on a tick the window's timer was due, draw ${draw + 1} (specs/enemies.md, The spawn timer)`,
        drive.arrivals.length,
      );
    }
    spawns.push(drive.arrivals[0]);
  }
  return spawns;
}

/**
 * The type of each of `count` window spawns drawn by {@link drawSpawns} with
 * nothing posed, in order. Each must be one the row lists, which is what a
 * handful of draws decides: a build that reaches into another window's roster
 * fails on the first spawn outside the row.
 */
export async function drawTypes(
  h: Harness,
  count = UNPOSED_DRAWS,
): Promise<EnemyId[]> {
  return (await drawSpawns(h, count)).map((spawn) => spawn.enemy.type);
}

/** One posed type and the type of the spawn the next due tick landed. */
export interface PosedSpawn {
  posed: EnemyId;
  spawned: EnemyId;
}

/**
 * Pose each type of window `index`'s row in turn through `setNextSpawnType`,
 * which "The next window spawn is of that type in place of the type drawn
 * from the window's types" (`specs/instrumentation.md`, "Drawn outcomes"), and
 * answer what the next due tick spawned under each, read the way
 * {@link drawSpawns} reads a draw. A build whose window cannot spawn one of
 * the row's types fails on that type.
 */
export async function drawPosedTypes(
  h: Harness,
  index: number,
): Promise<PosedSpawn[]> {
  const posedTypes: PosedSpawn[] = [];
  for (const posed of SPAWN_WINDOWS[index].types) {
    h.debug.setNextSpawnType(posed);
    const [spawn] = await drawSpawns(h, 1);
    posedTypes.push({ posed, spawned: spawn.enemy.type });
  }
  return posedTypes;
}

/**
 * Pose the clock at the first tick of window `index` with the spawn timer at
 * `0`, so the next tick driven is a tick of that window and a spawn is due on
 * it.
 *
 * Window `index` covers the ticks from `index × SPAWN_WINDOW × TICK_HZ`
 * onward: `specs/enemies.md` ("Windows") makes the index
 * `min(19, floor(time / SPAWN_WINDOW))` with `SPAWN_WINDOW` (`30`) seconds.
 * The clock is left ON that first tick rather than one before it, so the tick
 * driven next and the tick before it are both in the window and the timer's
 * window-change reset ("if the window index differs from the previous tick's
 * ... `spawnTimer = 0`") is not what makes the first spawn land — the posed
 * `0` is, exactly as it is at the start of a run.
 */
export function poseWindow(h: Harness, index: number): void {
  h.debug.setTick(index * SPAWN_WINDOW * TICK_HZ);
  h.debug.setSpawnTimer(0);
}

/** Where the posed commons of a cap scenario stand, in units from the lamplighter. */
const CAP_RING = 300;

/**
 * Place `count` commons of `type` around the lamplighter and answer their ids.
 *
 * They stand `CAP_RING` units out — well inside `DESPAWN_DISTANCE` (`1200`),
 * so nothing about them depends on the despawn rule, and well outside any
 * overlap with the lamplighter, so nothing about them depends on contact —
 * spread evenly by angle so the picture a check leaves shows them apart. The
 * spawn ring itself is farther out at `SPAWN_DISTANCE` (`760`), so a director
 * spawn is never confused with one of these.
 */
export function fillCommons(
  h: Harness,
  count: number,
  type: EnemyId = "moth",
): number[] {
  const { player } = h.snapshot().run;
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = pointAt(player, (360 * i) / count, CAP_RING);
    ids.push(placeEnemy(h, type, at.x, at.y));
  }
  return ids;
}

/** The frame a gnat swarm's line is laid out in, recovered from where it stands. */
export interface SwarmFrame {
  /** The line's midpoint: the mean of the gnats' centers. */
  center: Point;
  /** The unit direction `d` the line's center sits along from the lamplighter. */
  direction: Point;
  /** `(-dy, dx)`, the direction the line runs along. */
  perp: Point;
}

/**
 * Recover a swarm's `d` from the gnats it spawned.
 *
 * `specs/enemies.md` ("Scripted events") draws `d` at random, so a check
 * cannot know it in advance; what the specification fixes is the shape the
 * gnats stand in around it. It places gnat `i` at
 * `center + perp × (i − (SWARM_SIZE − 1) / 2) × spacing`, whose offsets sum to
 * zero, so the mean of the gnats' centers IS the line's center exactly, and
 * `d` is the unit vector from the lamplighter to it.
 */
export function swarmFrame(player: Point, gnats: readonly Point[]): SwarmFrame {
  const center = {
    x: gnats.reduce((sum, g) => sum + g.x, 0) / gnats.length,
    y: gnats.reduce((sum, g) => sum + g.y, 0) / gnats.length,
  };
  const direction = unit(center.x - player.x, center.y - player.y);
  return { center, direction, perp: { x: -direction.y, y: direction.x } };
}

/** The tick a scripted event at run-clock second `time` fires on. */
export function eventTick(time: number): number {
  return time * TICK_HZ;
}
