// Meltdown — the reactor floor: which tiles are blocked, and every route over
// the ones that are not (specs/floor.md, specs/mazing.md).
//
// A tile is addressed `(c, r)` and stored at `r * COLS + c`. It is OPEN when it
// is on the grid and no tower footprint covers it; the four openings are
// ordinary floor, so a footprint may cover part of one and the surge walks onto
// them.
//
// ROUTES ARE DISTANCE FIELDS. Both exhausts carry a Dijkstra field over the open
// tiles under the surge's own step rule — an orthogonal step costs `1`, a
// diagonal `sqrt(2)`, and a diagonal is only a step when both orthogonal tiles it
// cuts past are open. A unit's `remaining` is its field value, and it walks by
// stepping downhill from the tile it stands on, so re-pathing is not an event
// this file has to handle: the field is rebuilt whenever the blocked set changes
// and every unit is steering off the new one on the very next frame.

import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  LEFT_VENT_ROWS,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  TOP_VENT_COLS,
  inBounds,
} from "./constants";
import type { Exhaust, Vent } from "./types";

const SQRT2 = Math.SQRT2;
const TILE_COUNT = COLS * ROWS;

/** The tile index of `(c, r)`. */
export function idx(c: number, r: number): number {
  return r * COLS + c;
}
export function colOf(i: number): number {
  return i % COLS;
}
export function rowOf(i: number): number {
  return Math.floor(i / COLS);
}

/** One neighbour offset, and whether reaching it cuts a corner. */
interface Step {
  dc: number;
  dr: number;
  diag: boolean;
  cost: number;
}

const STEPS: readonly Step[] = [
  { dc: 1, dr: 0, diag: false, cost: 1 },
  { dc: -1, dr: 0, diag: false, cost: 1 },
  { dc: 0, dr: 1, diag: false, cost: 1 },
  { dc: 0, dr: -1, diag: false, cost: 1 },
  { dc: 1, dr: 1, diag: true, cost: SQRT2 },
  { dc: 1, dr: -1, diag: true, cost: SQRT2 },
  { dc: -1, dr: 1, diag: true, cost: SQRT2 },
  { dc: -1, dr: -1, diag: true, cost: SQRT2 },
];

/** The floor edge tiles each opening opens onto (specs/floor.md). */
export const OPENING_TILES: Record<Vent | Exhaust, readonly number[]> = {
  left: LEFT_VENT_ROWS.map((r) => idx(0, r)),
  top: TOP_VENT_COLS.map((c) => idx(c, 0)),
  right: RIGHT_EXHAUST_ROWS.map((r) => idx(COLS - 1, r)),
  bottom: BOTTOM_EXHAUST_COLS.map((c) => idx(c, ROWS - 1)),
};

/** One footprint on the floor: what it covers and which tower covers it. */
export interface Footprint {
  id: number;
  col: number;
  row: number;
  size: number;
}

/** Every tile of a `size x size` footprint anchored at `(col, row)`. */
export function footprintTiles(
  col: number,
  row: number,
  size: number,
): number[] {
  const tiles: number[] = [];
  for (let dr = 0; dr < size; dr += 1) {
    for (let dc = 0; dc < size; dc += 1) {
      const c = col + dc;
      const r = row + dr;
      if (inBounds(c, r)) tiles.push(idx(c, r));
    }
  }
  return tiles;
}

/**
 * One perimeter edge-tile of a footprint: the world face it lies on and the tile
 * immediately outside it, which may be off the grid — that is the casing.
 */
export interface PerimeterEdge {
  side: "N" | "E" | "S" | "W";
  oc: number;
  or: number;
}

/** Every perimeter edge-tile of a footprint, one per tile of each side. */
export function perimeterEdges(
  col: number,
  row: number,
  size: number,
): PerimeterEdge[] {
  const edges: PerimeterEdge[] = [];
  for (let k = 0; k < size; k += 1) {
    edges.push({ side: "N", oc: col + k, or: row - 1 });
    edges.push({ side: "S", oc: col + k, or: row + size });
    edges.push({ side: "W", oc: col - 1, or: row + k });
    edges.push({ side: "E", oc: col + size, or: row + k });
  }
  return edges;
}

/** Route lengths for every tile of the floor, in tiles. */
export type DistanceField = Float64Array<ArrayBuffer>;

/** A field with every tile unreachable, which is what a flood starts from. */
function emptyField(): DistanceField {
  const field = new Float64Array(TILE_COUNT);
  field.fill(Infinity);
  return field;
}

/** A binary min-heap over tile indices, keyed by a distance array. */
class MinHeap {
  private readonly items: number[] = [];
  constructor(private readonly dist: DistanceField) {}

  get size(): number {
    return this.items.length;
  }

  push(i: number): void {
    const a = this.items;
    a.push(i);
    let child = a.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.dist[a[parent]] <= this.dist[a[child]]) break;
      [a[parent], a[child]] = [a[child], a[parent]];
      child = parent;
    }
  }

  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length > 0) {
      a[0] = last;
      let parent = 0;
      for (;;) {
        const left = 2 * parent + 1;
        const right = left + 1;
        let smallest = parent;
        if (left < a.length && this.dist[a[left]] < this.dist[a[smallest]]) {
          smallest = left;
        }
        if (right < a.length && this.dist[a[right]] < this.dist[a[smallest]]) {
          smallest = right;
        }
        if (smallest === parent) break;
        [a[parent], a[smallest]] = [a[smallest], a[parent]];
        parent = smallest;
      }
    }
    return top;
  }
}

/**
 * The floor: the blocked set, who blocked each tile, and the two exhaust
 * distance fields kept in step with them.
 */
export class Floor {
  /** `1` where a footprint covers the tile. */
  readonly blocked = new Uint8Array(TILE_COUNT);
  /** The id of the tower covering each tile, or `-1`. */
  readonly owner = new Int32Array(TILE_COUNT).fill(-1);

  private right: DistanceField = emptyField();
  private bottom: DistanceField = emptyField();

  constructor(footprints: readonly Footprint[] = []) {
    this.rebuild(footprints);
  }

  /** Recompute the blocked set, the owners, and both fields, in that order. */
  rebuild(footprints: readonly Footprint[]): void {
    this.blocked.fill(0);
    this.owner.fill(-1);
    for (const f of footprints) {
      for (const tile of footprintTiles(f.col, f.row, f.size)) {
        this.blocked[tile] = 1;
        this.owner[tile] = f.id;
      }
    }
    this.right = this.distanceField(OPENING_TILES.right);
    this.bottom = this.distanceField(OPENING_TILES.bottom);
  }

  /** Whether a tile is on the grid and uncovered. */
  isOpen(c: number, r: number, extra?: ReadonlySet<number>): boolean {
    if (!inBounds(c, r)) return false;
    const i = idx(c, r);
    if (this.blocked[i] === 1) return false;
    return extra === undefined || !extra.has(i);
  }

  /** The distance field for an exhaust, in tiles. */
  field(exhaust: Exhaust): DistanceField {
    return exhaust === "right" ? this.right : this.bottom;
  }

  /** The route length from a tile to `exhaust`, in tiles; `Infinity` if walled. */
  remainingFrom(exhaust: Exhaust, c: number, r: number): number {
    if (!inBounds(c, r)) return Infinity;
    return this.field(exhaust)[idx(c, r)];
  }

  /**
   * The cheapest route from a vent's opening to its opposite exhaust's opening,
   * in tiles. `Infinity` when every tile of the vent's opening is covered.
   */
  routeLength(vent: Vent): number {
    const exhaust: Exhaust = vent === "left" ? "right" : "bottom";
    const field = this.field(exhaust);
    let best = Infinity;
    for (const tile of OPENING_TILES[vent]) {
      if (this.blocked[tile] === 1) continue;
      const d = field[tile];
      if (d < best) best = d;
    }
    return best;
  }

  /** The tiles of an opening no footprint covers, in the order they are listed. */
  openOpeningTiles(opening: Vent | Exhaust): number[] {
    return OPENING_TILES[opening].filter((tile) => this.blocked[tile] === 0);
  }

  /**
   * The next tile of the cheapest route from `(c, r)`, or `null` where no step
   * leads anywhere the field can reach.
   */
  bestNext(
    c: number,
    r: number,
    field: DistanceField,
  ): { c: number; r: number } | null {
    let best: { c: number; r: number } | null = null;
    let bestScore = Infinity;
    for (const step of STEPS) {
      const nc = c + step.dc;
      const nr = r + step.dr;
      if (!this.isOpen(nc, nr)) continue;
      if (step.diag && !this.cornerOpen(c, r, step)) continue;
      const d = field[idx(nc, nr)];
      if (!Number.isFinite(d)) continue;
      const score = d + step.cost;
      if (score < bestScore) {
        bestScore = score;
        best = { c: nc, r: nr };
      }
    }
    return best;
  }

  /**
   * A Dijkstra field over the open tiles down to `goals`, under the surge's step
   * rule. `extra` treats a further set of tiles as covered, which is how a
   * candidate placement is tested before it exists.
   */
  distanceField(
    goals: readonly number[],
    extra?: ReadonlySet<number>,
  ): DistanceField {
    const dist = emptyField();
    const heap = new MinHeap(dist);
    for (const goal of goals) {
      if (this.blocked[goal] === 1) continue;
      if (extra !== undefined && extra.has(goal)) continue;
      dist[goal] = 0;
      heap.push(goal);
    }
    while (heap.size > 0) {
      const current = heap.pop();
      const c = colOf(current);
      const r = rowOf(current);
      const d = dist[current];
      // A tile popped after a shorter route to it was already settled.
      if (d === Infinity) continue;
      for (const step of STEPS) {
        const nc = c + step.dc;
        const nr = r + step.dr;
        if (!this.isOpen(nc, nr, extra)) continue;
        if (step.diag && !this.cornerOpen(c, r, step, extra)) continue;
        const next = idx(nc, nr);
        const candidate = d + step.cost;
        if (candidate < dist[next]) {
          dist[next] = candidate;
          heap.push(next);
        }
      }
    }
    return dist;
  }

  /**
   * Which tiles can reach `goals` at all, as a flood under the same step rule.
   *
   * Reachability rather than distance, because the never-seal rule asks only
   * whether a route exists (specs/mazing.md).
   */
  reachable(goals: readonly number[], extra?: ReadonlySet<number>): Uint8Array {
    const seen = new Uint8Array(TILE_COUNT);
    const queue: number[] = [];
    for (const goal of goals) {
      if (this.blocked[goal] === 1) continue;
      if (extra !== undefined && extra.has(goal)) continue;
      seen[goal] = 1;
      queue.push(goal);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const c = colOf(current);
      const r = rowOf(current);
      for (const step of STEPS) {
        const nc = c + step.dc;
        const nr = r + step.dr;
        if (!this.isOpen(nc, nr, extra)) continue;
        if (step.diag && !this.cornerOpen(c, r, step, extra)) continue;
        const next = idx(nc, nr);
        if (seen[next] === 0) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    return seen;
  }

  /** Both orthogonal tiles a diagonal step cuts past are open. */
  private cornerOpen(
    c: number,
    r: number,
    step: Step,
    extra?: ReadonlySet<number>,
  ): boolean {
    return (
      this.isOpen(c + step.dc, r, extra) && this.isOpen(c, r + step.dr, extra)
    );
  }
}
