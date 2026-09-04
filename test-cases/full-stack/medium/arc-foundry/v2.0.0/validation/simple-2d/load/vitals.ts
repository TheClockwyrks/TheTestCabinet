// load — driving one kill and one leak, for the figures only an event reveals.
//
// Not a suite: vitest collects `*.test.ts` alone. A unit's speed and its flying
// bit are on the snapshot, but its BOUNTY and its LEAK value are not: they are
// paid rather than reported, so specs/economy.md is what defines them — "Kill
// bounty: the killed unit's bounty from specs/enemies.md, paid the instant it is
// removed", and "A unit that reaches the collector grounds out, costs its leak
// value in Grid Integrity, and is removed." Both are read here as the change
// they make.
//
// THE FIELD IS POSED SO THAT ONLY ONE THING CAN MOVE EITHER FIGURE. Charge has
// exactly three sources and sinks in the whole game (specs/economy.md): a
// bounty, the wave-clear bonus, and the two things Charge is spent on. So the
// yard carries one Capacitor and nothing else, no refinement is bought, no tower
// is upgraded, and the wave's own clear-and-pay resolution is HELD
// (specs/instrumentation.md) so no bonus can land in the same counter mid-reading.
// Nothing is parked to achieve that: the yard holds the gun and the unit being
// read, and nothing else. Grid Integrity has exactly one mover, a leak, and it
// never regenerates, so nothing but the unit being read can touch it either.
//
// THE GUN IS FAR FROM THE WALK. The Capacitor's `100` reach covers the point a kill
// is staged at and not the stretch a leak is walked over, so the unit being read is
// the only one it can fire at.

import { assertEqual } from "../assert";
import {
  COLLECTOR_WAYPOINT,
  type LoadType,
  structureCenter,
  tileCenter,
} from "../constants";
import {
  type Harness,
  holdWave,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  unitById,
  type YardOptions,
} from "../harness";

/** The Capacitor that lands the killing shot. Clear of every platform. */
const GUN = { col: 30, row: 20 };
const GUN_CENTER = structureCenter(GUN.col, GUN.row);

/** Where a unit is held to be shot: `60` units out, inside the Capacitor's `100`. */
const KILL_AT = { x: GUN_CENTER.x + 60, y: GUN_CENTER.y };

/** Three tiles short of the Substation's collector, and `310` from the gun. */
const LEAK_FROM = tileCenter(46, 20);

/** Five seconds: past the slowest cadence and the slowest walk staged here. */
const MAX_FRAMES = 600;

/** Frames between two samples of a sweep. */
const POLL = 6;

/** What one unit's leak revealed, read on the frame it grounded out. */
export interface Grounded {
  leak: number;
  speed: number;
  baseSpeed: number;
  flying: boolean;
}

/** Pose the field these readings are taken on. */
export function openField(h: Harness, options: YardOptions): void {
  openYard(h, options);
  holdWave(h);
  standComponent(h, "capacitor", 1, GUN.col, GUN.row);
}

/** The Charge one kill of that type paid, read on the frame the unit was removed. */
export async function bountyFor(h: Harness, type: LoadType): Promise<number> {
  const id = parkUnit(h, type, KILL_AT, { hp: 1 });
  const before = h.snapshot().charge;
  const removed = await h.until(
    (s) => !s.units.some((unit) => unit.id === id),
    { maxFrames: MAX_FRAMES, poll: POLL },
  );
  assertEqual(
    removed.hit,
    true,
    `the ${type} held under the Capacitor to be killed by it`,
  );
  return removed.snapshot.charge - before;
}

/**
 * Release one unit onto the same walk `leakFor` reads and leave it travelling.
 *
 * The two suites that read a unit in motion show one: a still taken after every
 * reading has been made would otherwise draw an empty yard.
 */
export function walkOne(h: Harness, type: LoadType): number {
  return releaseUnit(h, type, { at: LEAK_FROM, waypoint: COLLECTOR_WAYPOINT });
}

/**
 * What one unit of that type reads while it is travelling under its own legs.
 *
 * The roster's speed is what a unit MOVES at, so the reading is taken off a unit
 * the spawner released and nothing has touched: no hold, no slow, no gun.
 */
export function travelling(h: Harness, type: LoadType): Grounded {
  // The unit is released BEFORE the snapshot is taken: a snapshot read as an
  // argument beside the release is evaluated first, and would carry a yard the
  // unit is not on yet.
  const id = walkOne(h, type);
  const walking = unitById(h.snapshot(), id);
  return {
    leak: 0,
    speed: walking.speed,
    baseSpeed: walking.baseSpeed,
    flying: walking.flying,
  };
}

/** The Grid Integrity one leak of that type cost, and the speed it walked at. */
export async function leakFor(h: Harness, type: LoadType): Promise<Grounded> {
  const id = releaseUnit(h, type, {
    at: LEAK_FROM,
    waypoint: COLLECTOR_WAYPOINT,
  });
  // Read while it is still travelling: the roster's speed is what a unit moves
  // at, and a unit that has been held is not one that is moving.
  const walking = unitById(h.snapshot(), id);
  const before = h.snapshot().integrity;
  const grounded = await h.until(
    (s) => !s.units.some((unit) => unit.id === id),
    { maxFrames: MAX_FRAMES, poll: POLL },
  );
  assertEqual(
    grounded.hit,
    true,
    `the ${type} released three tiles short of the collector to ground out`,
  );
  return {
    leak: before - grounded.snapshot.integrity,
    speed: walking.speed,
    baseSpeed: walking.baseSpeed,
    flying: walking.flying,
  };
}
