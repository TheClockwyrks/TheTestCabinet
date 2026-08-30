// Meltdown — the routes across the floor, as the CASE computes them.
// CASE-PROVIDED.
//
// specs/mazing.md states the step rule and the metric; `src/constants.ts` seeds
// the grid, the tile size and the four openings. This module is those two
// together: an INDEPENDENT shortest-route search over the open tiles, written
// from the specification alone.
//
// WHY IT EXISTS, and it is the same reason `thermal.ts` does. A route length a
// check reads off the build is a length the check cannot fail. So a mazing check
// poses a floor, asks this module what specs/mazing.md says the cheapest route
// costs, and holds `paths.left.length`, `paths.top.length` or a unit's
// `remaining` against it.
//
// WHAT IT DOES NOT DECIDE. Which of several equal-cost routes a unit takes.
// Nothing pins a tie-break and nothing needs to: every item asserts a route's
// LENGTH, or that a unit reached its assigned exhaust, never the sequence of
// tiles it walked. Nor does anything here forbid a route that leads back over
// ground a unit has already covered — specs/mazing.md states the shortest-route
// rule and nothing else.
//
// NOTHING HERE IMPORTS A BUILD MODULE.

import { COLS, ROWS, TILE } from "../src/constants";
import {
  exhaustMidpoint,
  exhaustOf,
  exhaustTiles,
  footprintTiles,
  onGrid,
  tileAt,
  tileCentre,
  ventTiles,
  type Point,
  type Tile,
} from "./geometry";
import type {
  ExhaustName,
  MeltdownSnapshot,
  TowerSnapshot,
  UnitSnapshot,
  VentName,
} from "./surface";

/** The cost of one diagonal step, in tiles (specs/mazing.md). */
export const DIAGONAL = Math.SQRT2;

/**
 * Which tiles a floor blocks: every tile of every tower's footprint, whatever
 * its size and whatever kind of tower it is (specs/mazing.md, Every tower is a
 * wall).
 */
export type Blocked = boolean[];

/** The blocked set a list of reported towers produces. */
export function blockedOf(
  towers: readonly Pick<TowerSnapshot, "type" | "col" | "row">[],
): Blocked {
  const blocked: Blocked = new Array<boolean>(COLS * ROWS).fill(false);
  for (const tower of towers) {
    for (const tile of footprintTiles(tower.type, tower.col, tower.row)) {
      if (onGrid(tile.col, tile.row))
        blocked[tile.row * COLS + tile.col] = true;
    }
  }
  return blocked;
}

/** Whether a tile is open floor a route may pass through. */
export function isOpen(blocked: Blocked, col: number, row: number): boolean {
  return onGrid(col, row) && !blocked[row * COLS + col];
}

/** The eight steps out of a tile, and what each costs. */
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
 * The cheapest route cost from any of `from` to any of `to`, in tiles, or
 * `Infinity` where no route exists.
 *
 * The step rule is specs/mazing.md's: an orthogonal step to an open tile costs
 * `1`, and a diagonal step costs `sqrt(2)` and is only a step when BOTH of the
 * orthogonal tiles it cuts past are also open — so a diagonal between two
 * diagonally-touching towers is not a step and the unit goes around.
 *
 * A Dijkstra over the open tiles rather than an A*, because the floor is 50x36
 * and an exact answer with no heuristic to get wrong is worth more here than
 * speed.
 */
export function costBetween(
  blocked: Blocked,
  from: readonly Tile[],
  to: readonly Tile[],
): number {
  const goal = new Set(to.map((tile) => tile.row * COLS + tile.col));
  const best = new Float64Array(COLS * ROWS).fill(Infinity);
  // A simple binary heap: the frontier never holds more than the grid, and a
  // linear scan over 1800 tiles per pop would cost more than the search.
  const heap: { at: number; cost: number }[] = [];
  const push = (at: number, cost: number): void => {
    heap.push({ at, cost });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): { at: number; cost: number } => {
    const top = heap[0];
    const last = heap.pop();
    if (last !== undefined && heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let small = i;
        if (l < heap.length && heap[l].cost < heap[small].cost) small = l;
        if (r < heap.length && heap[r].cost < heap[small].cost) small = r;
        if (small === i) break;
        [heap[small], heap[i]] = [heap[i], heap[small]];
        i = small;
      }
    }
    return top;
  };

  for (const tile of from) {
    if (!isOpen(blocked, tile.col, tile.row)) continue;
    const at = tile.row * COLS + tile.col;
    if (best[at] === 0) continue;
    best[at] = 0;
    push(at, 0);
  }

  while (heap.length > 0) {
    const { at, cost } = pop();
    if (cost > best[at]) continue;
    if (goal.has(at)) return cost;
    const col = at % COLS;
    const row = (at - col) / COLS;
    for (const step of STEPS) {
      const nc = col + step.dc;
      const nr = row + step.dr;
      if (!isOpen(blocked, nc, nr)) continue;
      if (
        step.dc !== 0 &&
        step.dr !== 0 &&
        (!isOpen(blocked, col + step.dc, row) ||
          !isOpen(blocked, col, row + step.dr))
      ) {
        continue;
      }
      const next = cost + step.cost;
      const to = nr * COLS + nc;
      if (next < best[to]) {
        best[to] = next;
        push(to, next);
      }
    }
  }
  return Infinity;
}

/**
 * The cheapest route from a vent's opening to its opposite exhaust's opening,
 * in tiles — what the game reports as `paths.left.length` and
 * `paths.top.length`.
 */
export function ventRouteLength(
  towers: readonly Pick<TowerSnapshot, "type" | "col" | "row">[],
  vent: VentName,
): number {
  const blocked = blockedOf(towers);
  return costBetween(blocked, ventTiles(vent), exhaustTiles(exhaustOf(vent)));
}

/** Both vent-to-exhaust route lengths, as `paths` reports them. */
export function routeLengths(snapshot: MeltdownSnapshot): {
  left: number;
  top: number;
} {
  return {
    left: ventRouteLength(snapshot.towers, "left"),
    top: ventRouteLength(snapshot.towers, "top"),
  };
}

/**
 * What a WALKER standing at a logical stage point still has to travel, in tiles:
 * the cheapest route from the tile its centre occupies to any open opening tile
 * of its assigned exhaust.
 */
export function walkerRemaining(
  towers: readonly Pick<TowerSnapshot, "type" | "col" | "row">[],
  at: Point,
  exhaust: ExhaustName,
): number {
  const blocked = blockedOf(towers);
  const tile = tileAt(at.x, at.y);
  return costBetween(blocked, [tile], exhaustTiles(exhaust));
}

/**
 * What a FLYER still has to travel, in tiles: the straight-line distance from
 * its centre to the midpoint of its exhaust opening's run of tile centres,
 * divided by `TILE` (specs/mazing.md, Flyers ignore the maze).
 */
export function flyerRemaining(at: Point, exhaust: ExhaustName): number {
  const target = exhaustMidpoint(exhaust);
  return Math.hypot(target.x - at.x, target.y - at.y) / TILE;
}

/**
 * What specs/mazing.md says this reported unit still has to travel, computed
 * from its own centre and the floor it stands on — never from what it reported.
 */
export function remainingFor(
  snapshot: MeltdownSnapshot,
  unit: UnitSnapshot,
): number {
  const exhaust = exhaustOf(unit.vent);
  return unit.flying
    ? flyerRemaining(unit, exhaust)
    : walkerRemaining(snapshot.towers, unit, exhaust);
}

/**
 * Whether a floor would still be legal with `candidate`'s tiles blocked as well:
 * both vents still reach their opposite exhausts, and every ground unit already
 * on the floor still reaches its own (specs/mazing.md, The floor can never be
 * sealed).
 */
export function wouldSeal(
  snapshot: MeltdownSnapshot,
  candidate: Pick<TowerSnapshot, "type" | "col" | "row">,
): boolean {
  const towers = [...snapshot.towers, candidate];
  const blocked = blockedOf(towers);
  for (const vent of ["left", "top"] as const) {
    const cost = costBetween(
      blocked,
      ventTiles(vent),
      exhaustTiles(exhaustOf(vent)),
    );
    if (!Number.isFinite(cost)) return true;
  }
  for (const unit of snapshot.surge) {
    if (unit.flying) continue;
    const cost = costBetween(
      blocked,
      [tileAt(unit.x, unit.y)],
      exhaustTiles(exhaustOf(unit.vent)),
    );
    if (!Number.isFinite(cost)) return true;
  }
  return false;
}

/** The centre of the tile a unit's centre falls in. */
export function tileCentreUnder(at: Point): Point {
  const tile = tileAt(at.x, at.y);
  return tileCentre(tile.col, tile.row);
}
