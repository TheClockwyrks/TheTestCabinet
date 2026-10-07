// Meltdown — the route metric as pure arithmetic. CASE-PROVIDED.
//
// WHY THIS EXISTS. `specs/mazing.md` states the surge's step rule and the metric
// it is measured in — an orthogonal step costs `1` tile, a diagonal `sqrt(2)`,
// and a diagonal is only a step when both orthogonal tiles it cuts past are open
// — and the snapshot reports `paths.left.length`, `paths.top.length` and each
// unit's `remaining` in exactly that metric. So a mazing check asserts a length
// computed HERE, over the blocked set the check itself posed, rather than one a
// reference implementation happened to produce.
//
// NOTHING HERE READS THE BUILD'S OWN ANSWER. The blocked set is built from the
// footprints a check posed, with each tower's size taken from
// `specs/towers.md` through `constants.ts` rather than from the `size` a
// snapshot reports.
//
// NOTHING HERE FIXES A TIE-BREAK, AND NOTHING NEEDS TO. Equal-cost routes are an
// implementation's business: every check asserts a route's LENGTH, or that a
// unit reached its assigned exhaust, never the sequence of tiles it took.

import {
  COLS,
  OPENING_TILES,
  OPPOSITE,
  ROWS,
  TILE,
  TOWER_DEFS,
  inBounds,
  tileCX,
  tileCY,
  type Exhaust,
  type Tile,
  type TowerType,
  type Vent,
} from "./constants";
import type { UnitView } from "./harness";

const SQRT2 = Math.SQRT2;
const TILE_COUNT = COLS * ROWS;

/** The index a tile is stored at. */
export function idx(col: number, row: number): number {
  return row * COLS + col;
}
export function colOf(i: number): number {
  return i % COLS;
}
export function rowOf(i: number): number {
  return Math.floor(i / COLS);
}

/** One neighbour offset, and what reaching it costs. */
interface Step {
  dc: number;
  dr: number;
  diag: boolean;
  cost: number;
}

/** The eight steps the surge may take, at the costs `specs/mazing.md` fixes. */
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

/** The tiles a tower's footprint blocks, at the size `specs/towers.md` gives it. */
export function blockedBy(tower: {
  type: TowerType;
  col: number;
  row: number;
}): Tile[] {
  const size = TOWER_DEFS[tower.type].size;
  const tiles: Tile[] = [];
  for (let dr = 0; dr < size; dr += 1) {
    for (let dc = 0; dc < size; dc += 1) {
      const col = tower.col + dc;
      const row = tower.row + dr;
      if (inBounds(col, row)) tiles.push({ col, row });
    }
  }
  return tiles;
}

/** Every tile a floor of towers blocks, as the set the route metric runs over. */
export function blockedSet(
  towers: readonly { type: TowerType; col: number; row: number }[],
): Set<number> {
  const blocked = new Set<number>();
  for (const tower of towers) {
    for (const tile of blockedBy(tower)) blocked.add(idx(tile.col, tile.row));
  }
  return blocked;
}

function isOpen(
  blocked: ReadonlySet<number>,
  col: number,
  row: number,
): boolean {
  return inBounds(col, row) && !blocked.has(idx(col, row));
}

/** Both orthogonal tiles a diagonal step cuts past are open. */
function cornerOpen(
  blocked: ReadonlySet<number>,
  col: number,
  row: number,
  step: Step,
): boolean {
  return (
    isOpen(blocked, col + step.dc, row) && isOpen(blocked, col, row + step.dr)
  );
}

/** Route lengths for every tile of the floor, in tiles; `Infinity` where walled. */
export type DistanceField = Float64Array;

/**
 * A Dijkstra field over the open tiles down to `goals`, under the surge's step
 * rule.
 *
 * A plain array scan rather than a heap: the floor is 1800 tiles and a check
 * builds one field, so the clarity is worth more than the constant factor.
 */
export function distanceField(
  blocked: ReadonlySet<number>,
  goals: readonly Tile[],
): DistanceField {
  const dist = new Float64Array(TILE_COUNT).fill(Infinity);
  const settled = new Uint8Array(TILE_COUNT);
  const frontier = new Set<number>();
  for (const goal of goals) {
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
    const col = colOf(current);
    const row = rowOf(current);
    for (const step of STEPS) {
      const nc = col + step.dc;
      const nr = row + step.dr;
      if (!isOpen(blocked, nc, nr)) continue;
      if (step.diag && !cornerOpen(blocked, col, row, step)) continue;
      const next = idx(nc, nr);
      const candidate = dist[current] + step.cost;
      if (candidate < dist[next]) {
        dist[next] = candidate;
        frontier.add(next);
      }
    }
  }
  return dist;
}

/** The field down to an exhaust's opening tiles. */
export function exhaustField(
  blocked: ReadonlySet<number>,
  exhaust: Exhaust,
): DistanceField {
  return distanceField(blocked, [...OPENING_TILES[exhaust]]);
}

/**
 * The route length from a tile to `exhaust`, in tiles; `Infinity` where no route
 * exists. What the snapshot reports as a unit's `remaining`.
 */
export function remainingFrom(
  blocked: ReadonlySet<number>,
  exhaust: Exhaust,
  col: number,
  row: number,
): number {
  if (!inBounds(col, row)) return Infinity;
  return exhaustField(blocked, exhaust)[idx(col, row)];
}

/**
 * The cheapest route from a vent's opening to its opposite exhaust's opening, in
 * tiles. What the snapshot reports as `paths.left.length` and `paths.top.length`.
 */
export function routeLength(blocked: ReadonlySet<number>, vent: Vent): number {
  const field = exhaustField(blocked, OPPOSITE[vent]);
  let best = Infinity;
  for (const tile of OPENING_TILES[vent]) {
    if (!isOpen(blocked, tile.col, tile.row)) continue;
    const at = field[idx(tile.col, tile.row)];
    if (at < best) best = at;
  }
  return best;
}

/**
 * Whether a blocked set seals the floor: either vent left with no route to its
 * opposite exhaust.
 *
 * The exact predicate `specs/mazing.md` states a candidate placement is checked
 * against, so a check on the never-seal rule computes the answer here and reads
 * `build.valid` off the build.
 */
export function seals(blocked: ReadonlySet<number>): boolean {
  return (
    !Number.isFinite(routeLength(blocked, "left")) ||
    !Number.isFinite(routeLength(blocked, "top"))
  );
}

/**
 * A flyer's `remaining`: the straight-line distance from its centre to its
 * exhaust, in tiles (`specs/instrumentation.md`).
 *
 * The exhaust is a run of opening tiles rather than a point, so the nearest of
 * them is what a flight line is measured to.
 */
export function flyerRemaining(unit: {
  x: number;
  y: number;
  exhaust: Exhaust;
}): number {
  let best = Infinity;
  for (const tile of OPENING_TILES[unit.exhaust]) {
    const away = Math.hypot(
      tileCX(tile.col) - unit.x,
      tileCY(tile.row) - unit.y,
    );
    if (away < best) best = away;
  }
  return best / TILE;
}

/** A unit's `remaining` as the metric gives it, walking or flying. */
export function expectedRemaining(
  blocked: ReadonlySet<number>,
  unit: Pick<UnitView, "x" | "y" | "col" | "row" | "flying" | "exhaust">,
): number {
  return unit.flying
    ? flyerRemaining(unit)
    : remainingFrom(blocked, unit.exhaust, unit.col, unit.row);
}
