// mazing — the arithmetic only this group needs. CASE-PROVIDED.
//
// `routes.ts` and `geometry.ts` beside this directory already carry everything a
// route reading rests on: the Dijkstra field under the surge's step rule, the
// vent-to-exhaust lengths `paths` reports, a walker's and a flyer's `remaining`,
// the exhaust aim point, and the never-seal predicate. Five things belong to the
// mazing checks alone, so they live here rather than there:
//
//   - A ROUTE FROM A NAMED TILE. `routes.ts` measures a walker from a POINT,
//     because that is what a snapshot reports; a check that poses a tile wants
//     the same figure addressed the way it posed it.
//   - THE PERPENDICULAR DISTANCE TO A LINE, which is how "travels in a straight
//     line" is read off a sampled flight, and the plain distance between two
//     points that goes with it.
//   - THE CORNER-CUTTING MODEL. The wrong answer, computed on purpose: the same
//     field with specs/mazing.md's "when both of the orthogonal tiles that step
//     cuts past are also open" condition dropped. Nothing asserts it — it goes
//     into a failure message, so a build that cuts corners is named by the number
//     it produced rather than merely told its own was wrong.
//   - A STACKED WALL OF FOOTPRINTS, which three checks build and none wants to
//     spell out twice.
//   - WALKING A UNIT OFF THE FLOOR, which is how the two crossing checks read
//     WHERE a unit left: coarsely until it nears its exhaust, then sampled finely
//     to the poll it goes on.
//
// NOTHING HERE READS THE BUILD'S OWN ANSWER, and nothing here is a tolerance:
// every bound a check asserts is stated in that check, beside the figure the
// specification fixes for it.

import { COLS, ROWS } from "../constants";
import { exhaustTiles, type Point } from "../geometry";
import {
  blockedOf,
  costBetween,
  isOpen,
  DIAGONAL,
  type Blocked,
} from "../routes";
import {
  hasUnit,
  poseIdleTower,
  ticksFor,
  unitOf,
  type Harness,
  type MeltdownSnapshot,
  type UnitSnapshot,
} from "../harness";
import type { ExhaustName, TowerType } from "../surface";

/** One footprint a check poses: the type, and its top-left tile. */
export interface Footprint {
  type: TowerType;
  col: number;
  row: number;
}

/**
 * What specs/mazing.md's metric gives from tile `(col, row)` to the opening of
 * `exhaust`, over a floor holding exactly `towers`.
 *
 * The same field `routes.ts` computes, addressed by tile rather than by point,
 * because a check that poses a tile states its expectation in tiles.
 */
export function remainingFromTile(
  towers: readonly Footprint[],
  exhaust: ExhaustName,
  col: number,
  row: number,
): number {
  return costBetween(blockedOf(towers), [{ col, row }], exhaustTiles(exhaust));
}

/** The straight-line distance between two points, in logical stage units. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

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
  if (span === 0) return distance(at, from);
  return Math.abs(dy * (at.x - from.x) - dx * (at.y - from.y)) / span;
}

/* -------------------------------------------------------------------------- */
/* The corner-cutting model                                                   */
/* -------------------------------------------------------------------------- */

/** The eight steps out of a tile, at the costs specs/mazing.md fixes. */
const STEPS: readonly { dc: number; dr: number; cost: number }[] = [
  { dc: 1, dr: 0, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: DIAGONAL },
  { dc: 1, dr: -1, cost: DIAGONAL },
  { dc: -1, dr: 1, cost: DIAGONAL },
  { dc: -1, dr: -1, cost: DIAGONAL },
];

/**
 * The route length a build that CUT CORNERS would report: the same field
 * `routes.ts` computes, with specs/mazing.md's "when both of the orthogonal tiles
 * that step cuts past are also open" dropped.
 *
 * This is the wrong answer on purpose. `mazing/diagonal-needs-both-neighbours`
 * poses a floor where the two differ by more than three tiles and carries this
 * number into its failure message, so a build that squeezes between two
 * diagonally-touching towers is told which model it implemented.
 *
 * A plain Dijkstra from the goal tiles outward, which over 1800 tiles is exact
 * and instant; nothing here needs the heap `routes.ts` uses.
 */
export function cuttingRemaining(
  towers: readonly Footprint[],
  exhaust: ExhaustName,
  col: number,
  row: number,
): number {
  const blocked: Blocked = blockedOf(towers);
  const best = new Float64Array(COLS * ROWS).fill(Infinity);
  const settled = new Uint8Array(COLS * ROWS);
  const frontier = new Set<number>();
  for (const goal of exhaustTiles(exhaust)) {
    if (!isOpen(blocked, goal.col, goal.row)) continue;
    const at = goal.row * COLS + goal.col;
    best[at] = 0;
    frontier.add(at);
  }
  while (frontier.size > 0) {
    let current = -1;
    for (const candidate of frontier) {
      if (current < 0 || best[candidate] < best[current]) current = candidate;
    }
    frontier.delete(current);
    if (settled[current] === 1) continue;
    settled[current] = 1;
    const c = current % COLS;
    const r = (current - c) / COLS;
    for (const step of STEPS) {
      const nc = c + step.dc;
      const nr = r + step.dr;
      if (!isOpen(blocked, nc, nr)) continue;
      const next = nr * COLS + nc;
      const candidate = best[current] + step.cost;
      if (candidate < best[next]) {
        best[next] = candidate;
        frontier.add(next);
      }
    }
  }
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return Infinity;
  return best[row * COLS + col];
}

/* -------------------------------------------------------------------------- */
/* Posing a wall                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stack of same-type footprints down one column band, one per `rows` entry.
 *
 * The wall three checks build: `size` tiles wide and as tall as the rows given,
 * which at a 2x2 Arc and rows `0, 2, 4, ...` is a solid band with no diagonal
 * squeeze anywhere in it.
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
    if (!hasUnit(snapshot, id)) return true;
    last = unitOf(snapshot, id);
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
