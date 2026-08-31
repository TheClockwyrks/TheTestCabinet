// mazing/scenario — the posing and the reading only this group needs.
// CASE-PROVIDED.
//
// `routes.ts` beside this file is the specification's own route model; this is
// everything else the mazing checks share and no other group wants:
//
//   - THE STRICT ROSTER READERS. A check that posed a unit and then found it gone
//     has found a different failure from whatever it went on to read, so it is
//     named as one here rather than surfacing as a reading taken off `undefined`.
//   - THE PERPENDICULAR DISTANCE TO A LINE, which is how "travels in a straight
//     line" is read off a sampled flight.
//   - A STACKED WALL OF FOOTPRINTS, which three checks build and none wants to
//     spell out twice.
//   - WALKING A UNIT OFF THE FLOOR, which is how the two crossing checks read
//     WHERE a unit left: coarsely until it nears its exhaust, then sampled finely
//     to the poll it goes on.
//
// NOTHING HERE IS A THRESHOLD. It fixes arrangement — which column a wall runs
// down, how finely a departure is sampled — and every bound a check asserts is
// stated in that check, beside the figure the specification fixes for it.

import { fail } from "../assert";
import {
  poseIdleTower,
  ticksFor,
  unitById,
  type Harness,
  type MeltdownSnapshot,
  type Point,
  type TowerType,
  type UnitSnapshot,
} from "../harness";
import type { Footprint } from "./routes";

/* -------------------------------------------------------------------------- */
/* Reading the roster                                                         */
/* -------------------------------------------------------------------------- */

/** The unit carrying `id`, or a failure saying the roster no longer holds it. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `a unit with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/** Whether the roster still holds a unit carrying `id`. */
export function hasUnit(snapshot: MeltdownSnapshot, id: number): boolean {
  return unitById(snapshot, id) !== undefined;
}

/* -------------------------------------------------------------------------- */
/* Reading a line                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How far `at` lies off the line through `from` and `to`, in logical units.
 *
 * The reading a straight flight is held to: a point ON the line is `0` away from
 * it however far along it has travelled, so this says nothing about speed and
 * everything about heading.
 */
export function offLine(at: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  if (span === 0) return Math.hypot(at.x - from.x, at.y - from.y);
  return Math.abs(dy * (at.x - from.x) - dx * (at.y - from.y)) / span;
}

/* -------------------------------------------------------------------------- */
/* Posing a wall                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stack of same-type footprints down one column band, one per `rows` entry.
 *
 * The wall three checks build: as wide as the type's footprint and as tall as the
 * rows given, which at a 2x2 Arc and rows `0, 2, 4, ...` is a solid band with no
 * diagonal squeeze anywhere in it.
 */
export function stackedWall(
  type: TowerType,
  col: number,
  rows: readonly number[],
): Footprint[] {
  return rows.map((row) => ({ type, col, row }));
}

/**
 * Pose every footprint of a wall, guns held off, and hand back the ids in order.
 *
 * The guns are off because a wall is a wall: specs/mazing.md says a tower blocks
 * its footprint "whatever kind of tower it is", and a check about the maze has no
 * business also running a firing line at whatever unit it posed to read a route
 * off (specs/instrumentation.md, the firing gate).
 */
export function poseWall(
  h: Harness,
  footprints: readonly Footprint[],
): number[] {
  return footprints.map((at) => poseIdleTower(h, at.type, at.col, at.row));
}

/* -------------------------------------------------------------------------- */
/* Walking a unit off the floor                                               */
/* -------------------------------------------------------------------------- */

/** What a sweep saw of a unit on its way off the floor. */
export interface Departure {
  /** Whether the unit was gone from the roster when the sweep stopped. */
  left: boolean;
  /**
   * The last reading taken while it was still on the floor, or `null` if it was
   * never seen at all.
   *
   * This is what a check on WHERE a unit left reads, because a unit is removed on
   * the frame its centre reaches an opening tile of its exhaust (specs/mazing.md,
   * specs/surge.md): it is never observable standing on the tile it left through,
   * only on the one before it.
   */
  last: UnitSnapshot | null;
}

/** How a crossing is watched: how long each leg may run, and how finely. */
export interface WalkOptions {
  /** Seconds of game time the coarse approach may spend. */
  approachSeconds: number;
  /** Seconds of game time the sampled departure may spend. */
  departureSeconds: number;
  /** Frames between two samples of the departure. */
  pollFrames: number;
  /** Frames between two samples of the approach. */
  approachPollFrames?: number;
  /** Run once when the approach ends, before the sampled departure begins. */
  atApproach?: () => void;
}

/**
 * Walk a unit until it is gone from the roster, and hand back the last reading
 * taken while it was still there.
 *
 * TWO LEGS, AND WHY. A crossing of this floor is eleven to sixteen seconds of
 * game time at a Mote's own speed, which is two thousand frames of the suite's
 * clock; sampling every one of them would cost a check a thousand crossings into
 * the page for a reading it takes once. So the bulk of the walk runs at a coarse
 * poll until `near` says the unit has reached the approach, and the last stretch
 * then runs at `pollFrames`, which is what fixes how precisely the departure tile
 * is known and is stated by the check that calls this.
 *
 * `near` is the caller's, because which approach a check watches is the
 * scenario's business, and so is `atApproach`, which runs once between the two
 * legs — the moment a check whose evidence is a PICTURE wants it, with the unit
 * still on the floor and close to the exhaust it is about to leave through.
 * Nothing here asserts anything: a unit that never arrives comes back with `left`
 * false and whatever it was last seen doing, and the check decides.
 */
export async function walkOffTheFloor(
  h: Harness,
  id: number,
  near: (unit: UnitSnapshot) => boolean,
  options: WalkOptions,
): Promise<Departure> {
  let last: UnitSnapshot | null = null;
  /** Records the unit while it is there, and answers whether it has gone. */
  const watch = (snapshot: MeltdownSnapshot): boolean => {
    const seen = unitById(snapshot, id);
    if (seen === undefined) return true;
    last = seen;
    return false;
  };

  await h.until(
    (snapshot) => watch(snapshot) || (last !== null && near(last)),
    {
      maxFrames: ticksFor(options.approachSeconds),
      poll: options.approachPollFrames ?? 30,
    },
  );
  options.atApproach?.();
  const swept = await h.until(watch, {
    maxFrames: ticksFor(options.departureSeconds),
    poll: options.pollFrames,
  });

  return { left: !hasUnit(swept.snapshot, id), last };
}
