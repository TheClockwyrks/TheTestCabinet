// mazing/routes — the routes across the floor, as the SPECIFICATION computes
// them. CASE-PROVIDED.
//
// specs/mazing.md states the step rule and the metric; `src/constants.ts` seeds
// the grid, the tile size and the four openings. This module is those two
// together: an INDEPENDENT shortest-route search over the open tiles, written
// from the specification alone.
//
// WHY IT EXISTS. A route length a check reads off the build is a length the check
// cannot fail. So a check here poses a floor, asks this module what
// specs/mazing.md says the cheapest route costs, and holds `paths.left.length`,
// `paths.top.length` or a unit's `remaining` against it.
//
// WHY IT IS LOCAL TO THIS GROUP. `mazing` is the only group in this suite that
// reads a route LENGTH against a computed figure — `building/place-repaths` and
// `building/sell-reopens-and-repaths` assert that the reported length MOVED and
// deliberately assert no figure — so a shortest-route search in `harness.ts`
// would be a helper seventeen groups could not use.
//
// WHAT IT DOES NOT DECIDE. Which of several equal-cost routes a unit takes.
// Nothing pins a tie-break and nothing needs to: every item here asserts a
// route's LENGTH, or that a unit reached its assigned exhaust, never the sequence
// of tiles it walked. Nor does anything here forbid a route that leads back over
// ground a unit has already covered — specs/mazing.md states the shortest-route
// rule and nothing else.
//
// NOTHING HERE READS THE BUILD'S OWN ANSWER, AND NOTHING HERE IS A TOLERANCE:
// every bound a check asserts is stated in that check, beside the figure the
// specification fixes for it.

import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  LEFT_VENT_ROWS,
  OPPOSITE,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  TILE,
  TOP_VENT_COLS,
  inBounds,
} from "../../src/constants";
import {
  footprintTiles,
  sizeOf,
  tileCenter,
  type Point,
  type Tile,
  type TowerType,
} from "../harness";
import type { ExhaustName, VentName } from "../surface";

/** The cost of one diagonal step, in tiles (specs/mazing.md). */
export const DIAGONAL = Math.SQRT2;

/** One footprint a check poses: the type, and its top-left tile. */
export interface Footprint {
  type: TowerType;
  col: number;
  row: number;
}

/* -------------------------------------------------------------------------- */
/* The openings                                                               */
/* -------------------------------------------------------------------------- */

/** The tiles the named vent opens onto (specs/floor.md, The openings). */
export function ventTiles(vent: VentName): Tile[] {
  return vent === "left"
    ? LEFT_VENT_ROWS.map((row) => ({ col: 0, row }))
    : TOP_VENT_COLS.map((col) => ({ col, row: 0 }));
}

/** The tiles the named exhaust opens onto (specs/floor.md, The openings). */
export function exhaustTiles(exhaust: ExhaustName): Tile[] {
  return exhaust === "right"
    ? RIGHT_EXHAUST_ROWS.map((row) => ({ col: COLS - 1, row }))
    : BOTTOM_EXHAUST_COLS.map((col) => ({ col, row: ROWS - 1 }));
}

/** The exhaust a unit that entered at `vent` is assigned for its whole life. */
export function exhaustOf(vent: VentName): ExhaustName {
  return OPPOSITE[vent];
}

/**
 * The midpoint of an exhaust opening's run of tile centres, which is the point a
 * flyer travels to (specs/mazing.md, Flyers ignore the maze).
 */
export function exhaustMidpoint(exhaust: ExhaustName): Point {
  const tiles = exhaustTiles(exhaust);
  const first = tileCenter(tiles[0].col, tiles[0].row);
  const last = tileCenter(
    tiles[tiles.length - 1].col,
    tiles[tiles.length - 1].row,
  );
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
}

/* -------------------------------------------------------------------------- */
/* The blocked set                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Which tiles a floor blocks: every tile of every tower's footprint, whatever
 * its size and whatever kind of tower it is (specs/mazing.md, Every tower is a
 * wall).
 */
export type Blocked = boolean[];

/** The blocked set a list of footprints produces. */
export function blockedOf(towers: readonly Footprint[]): Blocked {
  const blocked: Blocked = new Array<boolean>(COLS * ROWS).fill(false);
  for (const tower of towers) {
    for (const tile of footprintTiles(
      tower.col,
      tower.row,
      sizeOf(tower.type),
    )) {
      if (inBounds(tile.col, tile.row))
        blocked[tile.row * COLS + tile.col] = true;
    }
  }
  return blocked;
}

/** Whether a tile is open floor a route may pass through. */
export function isOpen(blocked: Blocked, col: number, row: number): boolean {
  return inBounds(col, row) && !blocked[row * COLS + col];
}

/** The eight steps out of a tile, and what each costs (specs/mazing.md). */
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

/* -------------------------------------------------------------------------- */
/* The search                                                                 */
/* -------------------------------------------------------------------------- */

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
 * The cheapest route from a vent's opening to its opposite exhaust's opening, in
 * tiles — what the game reports as `paths.left.length` and `paths.top.length`
 * (specs/mazing.md, The route and its length).
 */
export function ventRouteLength(
  towers: readonly Footprint[],
  vent: VentName,
): number {
  return costBetween(
    blockedOf(towers),
    ventTiles(vent),
    exhaustTiles(exhaustOf(vent)),
  );
}

/**
 * What specs/mazing.md's metric gives from tile `(col, row)` to the opening of
 * `exhaust`, over a floor holding exactly `towers` — a walker's `remaining`,
 * addressed by the tile a check posed rather than by a point.
 */
export function remainingFromTile(
  towers: readonly Footprint[],
  exhaust: ExhaustName,
  col: number,
  row: number,
): number {
  return costBetween(blockedOf(towers), [{ col, row }], exhaustTiles(exhaust));
}

/**
 * What a FLYER still has to travel, in tiles: the straight-line distance from its
 * centre to the midpoint of its exhaust opening's run of tile centres, divided by
 * `TILE` (specs/mazing.md, Flyers ignore the maze).
 */
export function flyerRemaining(at: Point, exhaust: ExhaustName): number {
  const target = exhaustMidpoint(exhaust);
  return Math.hypot(target.x - at.x, target.y - at.y) / TILE;
}

/* -------------------------------------------------------------------------- */
/* The corner-cutting model                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The route length a build that CUT CORNERS would report: the same field
 * {@link costBetween} computes, with specs/mazing.md's "when both of the
 * orthogonal tiles that step cuts past are also open" condition dropped.
 *
 * This is the wrong answer on purpose. `mazing/diagonal-needs-both-neighbours`
 * poses a floor where the two differ by more than three tiles and carries this
 * number into its failure message, so a build that squeezes between two
 * diagonally-touching towers is told which model it implemented rather than
 * merely that its number was wrong. Nothing asserts it.
 *
 * A plain Dijkstra from the goal tiles outward, which over 1800 tiles is exact
 * and instant; nothing here needs the heap {@link costBetween} uses.
 */
export function cuttingRemaining(
  towers: readonly Footprint[],
  exhaust: ExhaustName,
  col: number,
  row: number,
): number {
  const blocked = blockedOf(towers);
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
  if (!inBounds(col, row)) return Infinity;
  return best[row * COLS + col];
}
