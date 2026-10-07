// Meltdown — routes across the floor.
//
// specs/mazing.md fixes the step rule and the metric: a step between tile
// centres is orthogonal, costing 1 tile, or diagonal, costing sqrt(2) and legal
// only when both of the orthogonal tiles it cuts past are open. A route is the
// cheapest sequence of such steps from a tile to any open opening tile of the
// unit's assigned exhaust.
//
// One Dijkstra pass per exhaust, run BACKWARDS from that exhaust's open opening
// tiles, gives the cost of every tile at once. The step rule is symmetric — the
// two cut tiles are the same pair whichever way the step is taken — so the
// backward field is the forward route's length, and every unit's `remaining` is
// one array read.
//
// The fields depend on the blocked set alone, so they are memoized against a
// signature of the towers standing. The cache is derived data and holds no
// authority: it is rebuilt from the towers whenever it misses.

import { COLS, ROWS } from "./constants";
import {
  exhaustTiles,
  footprintTiles,
  tileIndex,
  ventTiles,
  type Tile,
} from "./geometry";
import type { TowerState } from "./game";
import type { ExhaustName } from "./constants";

const DIAGONAL = Math.SQRT2;

/** The two distance fields and the two vent-to-exhaust route lengths. */
export interface Routes {
  /** Cost from each tile to the right exhaust's opening, `Infinity` if none. */
  readonly right: Float64Array;
  /** Cost from each tile to the bottom exhaust's opening. */
  readonly bottom: Float64Array;
  /** The left vent's opening to the right exhaust's, in tiles. */
  readonly leftLength: number;
  /** The top vent's opening to the bottom exhaust's, in tiles. */
  readonly topLength: number;
  /** One byte per tile: `1` where a tower's footprint covers it. */
  readonly blocked: Uint8Array;
}

/** The blocked set a roster of towers produces. */
export function blockedOf(towers: readonly TowerState[]): Uint8Array {
  const blocked = new Uint8Array(COLS * ROWS);
  for (const tower of towers) {
    for (const tile of footprintTiles(tower.type, tower.col, tower.row)) {
      if (
        tile.col >= 0 &&
        tile.col < COLS &&
        tile.row >= 0 &&
        tile.row < ROWS
      ) {
        blocked[tileIndex(tile.col, tile.row)] = 1;
      }
    }
  }
  return blocked;
}

/** A binary min-heap over `(cost, tile)` pairs. */
class Heap {
  private readonly cost: number[] = [];
  private readonly node: number[] = [];

  get size(): number {
    return this.node.length;
  }

  push(cost: number, node: number): void {
    this.cost.push(cost);
    this.node.push(node);
    let i = this.node.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cost[parent] <= this.cost[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { cost: number; node: number } {
    const cost = this.cost[0];
    const node = this.node[0];
    const lastCost = this.cost.pop() as number;
    const lastNode = this.node.pop() as number;
    if (this.node.length > 0) {
      this.cost[0] = lastCost;
      this.node[0] = lastNode;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < this.node.length && this.cost[left] < this.cost[best]) {
          best = left;
        }
        if (right < this.node.length && this.cost[right] < this.cost[best]) {
          best = right;
        }
        if (best === i) break;
        this.swap(best, i);
        i = best;
      }
    }
    return { cost, node };
  }

  private swap(a: number, b: number): void {
    const c = this.cost[a];
    this.cost[a] = this.cost[b];
    this.cost[b] = c;
    const n = this.node[a];
    this.node[a] = this.node[b];
    this.node[b] = n;
  }
}

const STEPS: readonly (readonly [number, number, number])[] = [
  [0, -1, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, 0, 1],
  [-1, -1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [1, 1, DIAGONAL],
];

/**
 * Whether a unit standing on `(col, row)` may step to `(col + dc, row + dr)`:
 * the target is on the grid and open, and a diagonal additionally needs both of
 * the orthogonal tiles it cuts past open (specs/mazing.md).
 */
export function stepAllowed(
  blocked: Uint8Array,
  col: number,
  row: number,
  dc: number,
  dr: number,
): boolean {
  const tc = col + dc;
  const tr = row + dr;
  if (tc < 0 || tc >= COLS || tr < 0 || tr >= ROWS) return false;
  if (blocked[tileIndex(tc, tr)] === 1) return false;
  if (dc !== 0 && dr !== 0) {
    if (blocked[tileIndex(tc, row)] === 1) return false;
    if (blocked[tileIndex(col, tr)] === 1) return false;
  }
  return true;
}

/** The cost from every tile to the cheapest of `targets`, under the step rule. */
function field(blocked: Uint8Array, targets: readonly Tile[]): Float64Array {
  const dist = new Float64Array(COLS * ROWS).fill(Infinity);
  const heap = new Heap();
  for (const tile of targets) {
    const index = tileIndex(tile.col, tile.row);
    if (blocked[index] === 1) continue;
    if (dist[index] > 0) {
      dist[index] = 0;
      heap.push(0, index);
    }
  }
  while (heap.size > 0) {
    const { cost, node } = heap.pop();
    if (cost > dist[node]) continue;
    const col = node % COLS;
    const row = (node - col) / COLS;
    for (const [dc, dr, weight] of STEPS) {
      if (!stepAllowed(blocked, col, row, dc, dr)) continue;
      const next = tileIndex(col + dc, row + dr);
      const candidate = cost + weight;
      if (candidate < dist[next] - 1e-12) {
        dist[next] = candidate;
        heap.push(candidate, next);
      }
    }
  }
  return dist;
}

/** The cheapest route from any open tile of `from` to the field `dist`. */
function openingLength(
  blocked: Uint8Array,
  from: readonly Tile[],
  dist: Float64Array,
): number {
  let best = Infinity;
  for (const tile of from) {
    const index = tileIndex(tile.col, tile.row);
    if (blocked[index] === 1) continue;
    best = Math.min(best, dist[index]);
  }
  return best;
}

/** The routes a given blocked set produces. */
export function routesFromBlocked(blocked: Uint8Array): Routes {
  const right = field(blocked, exhaustTiles("right"));
  const bottom = field(blocked, exhaustTiles("bottom"));
  return {
    right,
    bottom,
    leftLength: openingLength(blocked, ventTiles("left"), right),
    topLength: openingLength(blocked, ventTiles("top"), bottom),
    blocked,
  };
}

const CACHE = new Map<string, Routes>();
const CACHE_LIMIT = 24;

function signature(towers: readonly TowerState[]): string {
  let key = "";
  for (const tower of towers) key += `${tower.type}${tower.col},${tower.row};`;
  return key;
}

/**
 * The routes the standing towers produce, memoized on the blocked set they
 * describe. Nothing authoritative lives in the cache: a miss rebuilds it from
 * the towers alone.
 */
export function routesOf(towers: readonly TowerState[]): Routes {
  const key = signature(towers);
  const cached = CACHE.get(key);
  if (cached) return cached;
  const routes = routesFromBlocked(blockedOf(towers));
  if (CACHE.size >= CACHE_LIMIT) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, routes);
  return routes;
}

/** The distance field for one exhaust. */
export function fieldFor(routes: Routes, exhaust: ExhaustName): Float64Array {
  return exhaust === "right" ? routes.right : routes.bottom;
}

/**
 * The next tile of the route from `(col, row)`, or `null` when the unit stands
 * on the exhaust or has no route at all. Ties are broken by the fixed order of
 * `STEPS`, which nothing in the specification fixes and no item reads.
 */
export function nextStep(
  routes: Routes,
  exhaust: ExhaustName,
  col: number,
  row: number,
): Tile | null {
  const dist = fieldFor(routes, exhaust);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  const here = dist[tileIndex(col, row)];
  if (!Number.isFinite(here) || here === 0) return null;
  let best: Tile | null = null;
  let bestCost = Infinity;
  for (const [dc, dr, weight] of STEPS) {
    if (!stepAllowed(routes.blocked, col, row, dc, dr)) continue;
    const cost = dist[tileIndex(col + dc, row + dr)] + weight;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = { col: col + dc, row: row + dr };
    }
  }
  return bestCost < here + 1e-9 ? best : null;
}
