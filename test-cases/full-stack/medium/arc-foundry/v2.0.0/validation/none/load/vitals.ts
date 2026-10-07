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
// is upgraded, and `setWaveHold` holds the wave's own clear-and-pay resolution
// while a bounty is being read — because a clear pays a bonus into the same
// counter. Grid Integrity has exactly one mover, a leak, and it never
// regenerates, so nothing but the unit being read can touch it either.
//
// THE GATE RATHER THAN A BYSTANDER. Holding the resolution is one operation on
// the run, so the yard carries exactly the unit each reading is about: the gun
// and one unit, and nothing parked in a corner whose containment the build could
// break. The Capacitor's `100` reach covers the point a kill is staged at and
// nothing else, not the stretch a leak is walked over, so the unit being read is
// the only one it can fire at.

import { assertEqual } from "../assert";
import {
  COLLECTOR_WAYPOINT,
  type LoadType,
  structureCenter,
  tileCenter,
} from "../constants";
import {
  holdWaveOpen,
  openYard,
  parkUnit,
  releaseUnit,
  standComponent,
  unitById,
  type Harness,
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

/** What one unit reads while it is travelling under its own legs. */
export interface Travelling {
  /** Its current speed, after any slow. Carrying none, this is the roster's. */
  speed: number;
  /** The roster speed it was given. */
  baseSpeed: number;
  flying: boolean;
}

/** What one unit's leak revealed, read on the frame it grounded out. */
export interface Grounded {
  leak: number;
  speed: number;
  baseSpeed: number;
  flying: boolean;
}

/** Pose the field these readings are taken on. */
export async function openField(
  h: Harness,
  options: YardOptions,
): Promise<void> {
  await openYard(h, options);
  await holdWaveOpen(h);
  await standComponent(h, "capacitor", 1, GUN.col, GUN.row);
}

/**
 * Release one unit of that type, let it walk a frame, and read it moving.
 *
 * The roster's speed is what a unit MOVES at, so the read is taken off a unit
 * that is travelling rather than off one that has been held: a frozen unit is not
 * one that is moving, and a build that reported a speed it never walks at would
 * pass a read taken at the spawn. The unit is removed afterwards, so the next type
 * is read on a yard holding nothing else.
 */
export async function travellingFor(
  h: Harness,
  type: LoadType,
): Promise<Travelling> {
  const id = await releaseUnit(h, type);
  await h.advance(1);
  const unit = unitById(await h.snapshot(), id);
  await h.debug.clearUnits();
  return {
    speed: unit.speed,
    baseSpeed: unit.baseSpeed,
    flying: unit.flying,
  };
}

/** The Charge one kill of that type paid, read on the frame the unit was removed. */
export async function bountyFor(h: Harness, type: LoadType): Promise<number> {
  const id = await parkUnit(h, type, KILL_AT, { hp: 1 });
  const before = (await h.snapshot()).charge;
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

/** The Grid Integrity one leak of that type cost, and the speed it walked at. */
export async function leakFor(h: Harness, type: LoadType): Promise<Grounded> {
  const id = await releaseUnit(h, type, {
    at: LEAK_FROM,
    waypoint: COLLECTOR_WAYPOINT,
  });
  // Read while it is still travelling: the roster's speed is what a unit moves
  // at, and a unit that has been held is not one that is moving.
  const walking = unitById(await h.snapshot(), id);
  const before = (await h.snapshot()).integrity;
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
