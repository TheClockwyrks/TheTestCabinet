// mazing — the arithmetic only this group needs. CASE-PROVIDED.
//
// `routes.ts` beside this directory already carries the route metric every group
// may want: the Dijkstra field under the surge's step rule, `paths.left` /
// `paths.top`, a unit's `remaining`, and the never-seal predicate. Five things
// belong to the mazing checks alone, so they live here rather than there:
//
//   - THE FLYER'S AIM POINT. `specs/mazing.md` fixes it exactly: "the centre of
//     its assigned exhaust's opening, which is the midpoint of that opening's
//     run of tile centres". That is one point, not the nearest tile of the run,
//     and the two differ by half a tile at the ends of a four-tile opening — so
//     the flight checks compute it here, from the specification's own words.
//   - THE PERPENDICULAR DISTANCE TO A LINE, which is how "travels in a straight
//     line" is read off a sampled flight.
//   - THE CORNER-CUTTING MODEL. The wrong answer, computed on purpose: the same
//     field with the "both orthogonal tiles open" condition dropped. Nothing
//     asserts it — it goes into the failure message, so a build that cuts
//     corners is named by the number it produced rather than merely told it was
//     wrong.
//   - A STACKED WALL OF FOOTPRINTS, which two checks build and neither wants to
//     spell twice.
//   - WALKING A UNIT OFF THE FLOOR, which is how the two crossing checks read
//     WHERE a unit left: coarse and off camera until it nears its exhaust, then
//     sampled finely to the frame it goes.
//
// NOTHING HERE READS THE BUILD'S OWN ANSWER, and nothing here is a tolerance:
// every bound a check asserts is stated in that check, beside the figure the
// specification fixes for it.

import {
  COLS,
  OPENING_TILES,
  ROWS,
  TILE,
  inBounds,
  tileCX,
  tileCY,
  type Exhaust,
  type TowerType,
} from "../constants";
import {
  framesFor,
  poseIdleTower,
  unitById,
  type Harness,
  type MeltdownSnapshot,
  type UnitView,
} from "../harness";
import { idx } from "../routes";

/** One footprint a check poses: the type, and its top-left tile. */
export interface Footprint {
  type: TowerType;
  col: number;
  row: number;
}

/** A point on the stage, in logical units. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The point a flyer aims at: the midpoint of its exhaust opening's run of tile
 * centres (`specs/mazing.md`).
 *
 * For the right exhaust that is the centre of column `49` at the midpoint of
 * rows `16..19`, which is `(958.5, 360)` — half a tile from the nearest tile
 * centre of the run, which is exactly why this is computed from the run rather
 * than from one of its tiles.
 */
export function exhaustPoint(exhaust: Exhaust): Point {
  const tiles = OPENING_TILES[exhaust];
  const first = tiles[0];
  const last = tiles[tiles.length - 1];
  return {
    x: (tileCX(first.col) + tileCX(last.col)) / 2,
    y: (tileCY(first.row) + tileCY(last.row)) / 2,
  };
}

/**
 * A flyer's `remaining`: the straight-line distance from its centre to its
 * exhaust's aim point, in tiles (`specs/mazing.md`,
 * `specs/instrumentation.md`).
 */
export function flyerRemaining(at: Point, exhaust: Exhaust): number {
  const goal = exhaustPoint(exhaust);
  return Math.hypot(goal.x - at.x, goal.y - at.y) / TILE;
}

/**
 * How far `at` lies off the line through `from` and `to`, in logical units.
 *
 * The reading a straight flight is held to: a point on the line is `0` away from
 * it however far along the line it has travelled, so this says nothing about
 * speed and everything about heading.
 */
export function offLine(at: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  if (span === 0) return Math.hypot(at.x - from.x, at.y - from.y);
  return Math.abs(dy * (at.x - from.x) - dx * (at.y - from.y)) / span;
}

/* -------------------------------------------------------------------------- */
/* The corner-cutting model                                                   */
/* -------------------------------------------------------------------------- */

const SQRT2 = Math.SQRT2;
const TILE_COUNT = COLS * ROWS;

/** The eight neighbour offsets, at the costs `specs/mazing.md` fixes. */
const STEPS: readonly { dc: number; dr: number; cost: number }[] = [
  { dc: 1, dr: 0, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: SQRT2 },
  { dc: 1, dr: -1, cost: SQRT2 },
  { dc: -1, dr: 1, cost: SQRT2 },
  { dc: -1, dr: -1, cost: SQRT2 },
];

function isOpen(
  blocked: ReadonlySet<number>,
  col: number,
  row: number,
): boolean {
  return inBounds(col, row) && !blocked.has(idx(col, row));
}

/**
 * The route length a build that CUT CORNERS would report: the same field, with
 * `specs/mazing.md`'s "when both of the orthogonal tiles that step cuts past are
 * also open" dropped.
 *
 * This is the wrong answer on purpose. `mazing/diagonal-needs-both-neighbours`
 * poses a floor where the two differ by more than three tiles and carries this
 * number into its failure message, so a build that squeezes between two
 * diagonally-touching towers is told which model it implemented.
 */
export function cuttingRemaining(
  blocked: ReadonlySet<number>,
  exhaust: Exhaust,
  col: number,
  row: number,
): number {
  if (!inBounds(col, row)) return Infinity;
  const dist = new Float64Array(TILE_COUNT).fill(Infinity);
  const settled = new Uint8Array(TILE_COUNT);
  const frontier = new Set<number>();
  for (const goal of OPENING_TILES[exhaust]) {
    if (!isOpen(blocked, goal.col, goal.row)) continue;
    const at = idx(goal.col, goal.row);
    dist[at] = 0;
    frontier.add(at);
  }
  while (frontier.size > 0) {
    let current = -1;
    for (const candidate of frontier) {
      if (current < 0 || dist[candidate] < dist[current]) current = candidate;
    }
    frontier.delete(current);
    if (settled[current] === 1) continue;
    settled[current] = 1;
    const c = current % COLS;
    const r = Math.floor(current / COLS);
    for (const step of STEPS) {
      const nc = c + step.dc;
      const nr = r + step.dr;
      if (!isOpen(blocked, nc, nr)) continue;
      const next = idx(nc, nr);
      const candidate = dist[current] + step.cost;
      if (candidate < dist[next]) {
        dist[next] = candidate;
        frontier.add(next);
      }
    }
  }
  return dist[idx(col, row)];
}

/* -------------------------------------------------------------------------- */
/* Posing a wall                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A stack of same-type footprints down one column band, one per `rows` entry.
 *
 * The wall two checks build: `size` tiles wide and as tall as the rows given,
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
 * The guns are off because a wall is a wall: `specs/mazing.md` says a tower
 * blocks its footprint "whatever kind of tower it is", and a check about the
 * maze has no business also running a firing line at whatever unit it posed to
 * read a route off (`specs/instrumentation.md`, the firing gate).
 */
export async function poseWall(
  h: Harness,
  footprints: readonly Footprint[],
): Promise<number[]> {
  const ids: number[] = [];
  for (const at of footprints) {
    ids.push(await poseIdleTower(h, at.type, at.col, at.row));
  }
  return ids;
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
   * This is what a check on WHERE a unit left reads, because a unit is removed
   * on the frame its centre reaches an opening tile of its exhaust
   * (`specs/mazing.md`, `specs/surge.md`): it is never observable standing on
   * the tile it left through, only on the one before it.
   */
  last: UnitView | null;
}

/**
 * Walk a unit until it is gone from the roster, and hand back the last reading
 * taken while it was still there.
 *
 * TWO PHASES, AND WHY. A crossing of the floor is eleven to sixteen seconds of
 * game time at a Mote's own speed, which is two thousand frames: sampling every
 * one of them would cost a check a thousand crossings into the page for a
 * reading it takes once. So the bulk of the walk runs through
 * {@link Harness.coast}, off camera and unsampled, until `near` says the unit has
 * reached the approach; the last stretch then runs through
 * {@link Harness.advance}, sampled every `pollFrames`, which is what fixes how
 * precisely the departure tile is known and is stated by the check that calls
 * this.
 *
 * `near` is the caller's, because which approach a check watches is the
 * scenario's business, and so is `atApproach`, which runs once between the two
 * phases — the moment a check whose evidence is a PICTURE wants it, with the unit
 * still on the floor and close to the exhaust it is about to leave through.
 * Nothing here asserts anything: a unit that never arrives comes back with
 * `left` false and whatever it was last seen doing, and the check decides.
 */
export async function walkOffTheFloor(
  h: Harness,
  id: number,
  near: (unit: UnitView) => boolean,
  options: {
    /** Seconds of game time the off-camera approach may spend. */
    approachSeconds: number;
    /** Seconds of game time the sampled departure may spend. */
    departureSeconds: number;
    /** Frames between two samples of the departure. */
    pollFrames: number;
    /** Run once when the approach ends, before the sampled departure begins. */
    atApproach?: () => Promise<void>;
  },
): Promise<Departure> {
  let last: UnitView | null = null;
  const watch = (snapshot: MeltdownSnapshot): boolean => {
    const unit = unitById(snapshot, id);
    if (unit !== undefined) last = unit;
    return unit === undefined;
  };

  await h.coastUntil(
    (snapshot) => {
      if (watch(snapshot)) return true;
      return last !== null && near(last);
    },
    { maxSeconds: options.approachSeconds, pollSeconds: 0.25 },
  );
  if (options.atApproach !== undefined) await options.atApproach();
  const swept = await h.until(watch, {
    maxFrames: framesFor(options.departureSeconds),
    poll: options.pollFrames,
  });

  return { left: unitById(swept.snapshot, id) === undefined, last };
}
