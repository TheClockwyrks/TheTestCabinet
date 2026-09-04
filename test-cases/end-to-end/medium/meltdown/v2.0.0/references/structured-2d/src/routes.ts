// Meltdown — the routes across the floor.
//
// `specs/mazing.md` states the surge's step rule and the metric its routes are
// measured in, and this module is that rule as arithmetic: an orthogonal step
// to an open tile costs 1, a diagonal costs sqrt(2) and is a step only when
// both of the orthogonal tiles it cuts past are open, and a route is the
// cheapest sequence of such steps to any open opening tile of the unit's
// assigned exhaust.
//
// The routes are held as two DISTANCE FIELDS, one per exhaust, each the cost of
// the cheapest route from every tile to that exhaust's opening. One field
// answers every question the game asks: a unit's `remaining` is its own tile's
// entry, the step it takes next is the neighbour that minimises the step's cost
// plus the neighbour's entry, `paths.left` and `paths.top` are the cheapest
// entries over the two vents' open opening tiles, and the never-seal rule is
// whether the fields a CANDIDATE footprint would produce still reach.
//
// The step rule is symmetric, so a field computed outward from the exhaust
// gives the cost of travelling inward to it. Nothing here is cached at module
// level: a field is rebuilt whenever the blocked set changes, which
// `src/build.ts` is the single place that happens.

import {
  COLS,
  ROWS,
  inBounds,
  type ExhaustName,
  type VentName,
} from "./constants";
import {
  blockedMask,
  exhaustTiles,
  tileIndex,
  ventTiles,
  type Tile,
} from "./geometry";
import type { TowerState } from "./game";

/** The cost of one diagonal step, in tiles. */
export const DIAGONAL_COST = Math.SQRT2;

/** The eight steps a ground unit may take, orthogonals first. */
const STEPS: readonly { dc: number; dr: number; cost: number }[] = [
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 1, dr: -1, cost: DIAGONAL_COST },
  { dc: 1, dr: 1, cost: DIAGONAL_COST },
  { dc: -1, dr: 1, cost: DIAGONAL_COST },
  { dc: -1, dr: -1, cost: DIAGONAL_COST },
];

/** The blocked set and the two distance fields computed over it. */
export interface Routes {
  readonly blocked: Uint8Array;
  readonly fields: Readonly<Record<ExhaustName, Float64Array>>;
  readonly lengths: Readonly<Record<VentName, number>>;
}

/** Whether a step from `(c, r)` by `(dc, dr)` is a step at all. */
function stepAllowed(
  blocked: Uint8Array,
  c: number,
  r: number,
  dc: number,
  dr: number,
): boolean {
  const nc = c + dc;
  const nr = r + dr;
  if (!inBounds(nc, nr) || blocked[tileIndex(nc, nr)] === 1) return false;
  if (dc === 0 || dr === 0) return true;
  // A diagonal is a step only when both of the orthogonal tiles it cuts past
  // are open, so a gap between two diagonally-touching towers is not a way
  // through (specs/mazing.md).
  return blocked[tileIndex(nc, r)] === 0 && blocked[tileIndex(c, nr)] === 0;
}

/**
 * The cheapest cost from every tile to any of `sources`, under the step rule.
 * Unreachable tiles, and blocked ones, hold `Infinity`.
 */
export function distanceField(
  blocked: Uint8Array,
  sources: readonly Tile[],
): Float64Array {
  const size = COLS * ROWS;
  const dist = new Float64Array(size).fill(Infinity);
  // A binary heap over (cost, tile index). The grid is small enough that the
  // pairs live in two parallel arrays rather than in objects.
  const heapCost: number[] = [];
  const heapNode: number[] = [];

  const push = (cost: number, node: number): void => {
    heapCost.push(cost);
    heapNode.push(node);
    let i = heapCost.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapCost[parent] <= heapCost[i]) break;
      [heapCost[parent], heapCost[i]] = [heapCost[i], heapCost[parent]];
      [heapNode[parent], heapNode[i]] = [heapNode[i], heapNode[parent]];
      i = parent;
    }
  };

  const pop = (): { cost: number; node: number } => {
    const cost = heapCost[0];
    const node = heapNode[0];
    const lastCost = heapCost.pop() as number;
    const lastNode = heapNode.pop() as number;
    if (heapCost.length > 0) {
      heapCost[0] = lastCost;
      heapNode[0] = lastNode;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heapCost.length && heapCost[left] < heapCost[smallest]) {
          smallest = left;
        }
        if (right < heapCost.length && heapCost[right] < heapCost[smallest]) {
          smallest = right;
        }
        if (smallest === i) break;
        [heapCost[smallest], heapCost[i]] = [heapCost[i], heapCost[smallest]];
        [heapNode[smallest], heapNode[i]] = [heapNode[i], heapNode[smallest]];
        i = smallest;
      }
    }
    return { cost, node };
  };

  for (const tile of sources) {
    if (!inBounds(tile.col, tile.row)) continue;
    const node = tileIndex(tile.col, tile.row);
    if (blocked[node] === 1) continue;
    if (dist[node] === 0) continue;
    dist[node] = 0;
    push(0, node);
  }

  while (heapCost.length > 0) {
    const { cost, node } = pop();
    if (cost > dist[node]) continue;
    const c = node % COLS;
    const r = (node - c) / COLS;
    for (const step of STEPS) {
      if (!stepAllowed(blocked, c, r, step.dc, step.dr)) continue;
      const next = tileIndex(c + step.dc, r + step.dr);
      const candidate = cost + step.cost;
      if (candidate < dist[next] - 1e-12) {
        dist[next] = candidate;
        push(candidate, next);
      }
    }
  }

  return dist;
}

/** The cheapest entry of `field` over the open opening tiles of a vent. */
function ventLength(blocked: Uint8Array, field: Float64Array, vent: VentName) {
  let best = Infinity;
  for (const tile of ventTiles(vent)) {
    const node = tileIndex(tile.col, tile.row);
    if (blocked[node] === 1) continue;
    if (field[node] < best) best = field[node];
  }
  return best;
}

/** The routes a blocked set produces. */
export function routesFor(blocked: Uint8Array): Routes {
  const right = distanceField(blocked, exhaustTiles("right"));
  const bottom = distanceField(blocked, exhaustTiles("bottom"));
  return {
    blocked,
    fields: { right, bottom },
    lengths: {
      left: ventLength(blocked, right, "left"),
      top: ventLength(blocked, bottom, "top"),
    },
  };
}

/** The routes a set of towers produces. */
export function computeRoutes(towers: readonly TowerState[]): Routes {
  return routesFor(blockedMask(towers));
}

/**
 * The cost of the cheapest route from `(col, row)` to that exhaust.
 *
 * A tile a tower was dropped onto is blocked and holds `Infinity`, and a unit
 * standing there still has a route: the cheapest step off the tile plus the
 * cost from where it lands. That is what keeps `remaining` readable for a unit
 * a footprint was posed over, which only `addTower` can produce.
 */
export function remainingFrom(
  routes: Routes,
  exhaust: ExhaustName,
  col: number,
  row: number,
): number {
  if (!inBounds(col, row)) return Infinity;
  const field = routes.fields[exhaust];
  const here = field[tileIndex(col, row)];
  if (Number.isFinite(here)) return here;
  let best = Infinity;
  for (const step of STEPS) {
    if (!stepAllowed(routes.blocked, col, row, step.dc, step.dr)) continue;
    const cost = step.cost + field[tileIndex(col + step.dc, row + step.dr)];
    if (cost < best) best = cost;
  }
  return best;
}

/**
 * The tile a unit standing on `(col, row)` steps to next: the neighbour that
 * minimises the step's cost plus that neighbour's own route. Ties are broken by
 * the order of `STEPS`, orthogonals first, so the choice is deterministic;
 * nothing in the specification fixes which of several equal-cost routes a unit
 * takes.
 */
export function nextStep(
  routes: Routes,
  exhaust: ExhaustName,
  col: number,
  row: number,
): Tile | null {
  if (!inBounds(col, row)) return null;
  const field = routes.fields[exhaust];
  let best: Tile | null = null;
  let bestCost = Infinity;
  for (const step of STEPS) {
    if (!stepAllowed(routes.blocked, col, row, step.dc, step.dr)) continue;
    const nc = col + step.dc;
    const nr = row + step.dr;
    const cost = step.cost + field[tileIndex(nc, nr)];
    if (cost < bestCost - 1e-12) {
      bestCost = cost;
      best = { col: nc, row: nr };
    }
  }
  return Number.isFinite(bestCost) ? best : null;
}
