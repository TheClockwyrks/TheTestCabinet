// Arc Foundry — the tile grid, the ordered-waypoint pathing, and placement legality
// (specs/yard.md, specs/pathing.md).
//
// The yard is a `GRID_COLS` by `GRID_ROWS` grid of square tiles. Each map defines an
// ordered chain `[entry, WP1..WP6, collector]`; a walking unit heads for each node in
// turn, taking the shortest open route around the walls between consecutive nodes, and a
// flyer ignores the walls and takes the straight line. Every structure is a
// `FOOTPRINT` by `FOOTPRINT` wall, and a map's housings are impassable and never
// buildable. Each waypoint carries a four-tile platform that is walkable and never
// buildable, so a waypoint can never be walled off. A placement that would seal a
// segment or strand a walking unit is refused, and the floor re-paths live.
//
// A `Board` is derived entirely from a map, so the three of them are built once, here,
// and looked up by identifier. It holds no game state: every query takes the structures
// and the units it is about. Nothing in this module draws or reads a clock, so the
// pathing runs identically under a browser frame and under a counted advance.

import { GRID_COLS, GRID_ROWS, MAPS, TILE, type FoundryMap, type MapId } from "./constants";
import {
  GRID_X0,
  GRID_Y0,
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  tileCenter,
} from "./tables";
import type { Pt, Structure, TileRef, TileState, Unit } from "./types";

/**
 * A per-tile occupancy derived from the structures on the yard and the map's housings:
 * `0` open, `1` a structure's footprint, `2` a housing. Indexed `row * GRID_COLS + col`.
 */
export type Occupancy = Uint8Array;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The four orthogonal steps, each costing one tile. */
const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The four diagonal steps, each costing the diagonal of one tile. */
const DIAG: readonly (readonly [number, number])[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const SQRT2 = Math.SQRT2;

/** The row a waypoint platform's stem reaches toward: the middle of the grid. */
const MID_ROW = Math.floor(GRID_ROWS / 2);

/** A binary min-heap over tile indices, keyed by the search's f-score. */
class MinHeap {
  private idx: number[] = [];
  private key: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(node: number, f: number): void {
    this.idx.push(node);
    this.key.push(f);
    let i = this.idx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.key[p]! <= this.key[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.idx[0]!;
    const lastNode = this.idx.pop()!;
    const lastKey = this.key.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = lastNode;
      this.key[0] = lastKey;
      let i = 0;
      const n = this.idx.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.key[l]! < this.key[m]!) m = l;
        if (r < n && this.key[r]! < this.key[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.idx[a]!;
    this.idx[a] = this.idx[b]!;
    this.idx[b] = ti;
    const tk = this.key[a]!;
    this.key[a] = this.key[b]!;
    this.key[b] = tk;
  }
}

/**
 * One map's grid and pathing.
 *
 * Every method is a pure query over the arguments it is handed; the board itself never
 * changes after it is built, which is why one per map is enough for the whole run.
 */
export class Board {
  readonly map: FoundryMap;
  /** The full ordered chain: the entry, the six waypoints, then the collector. */
  readonly chain: readonly TileRef[];
  /** Every tile of every waypoint platform, as `row * GRID_COLS + col`. */
  readonly waypointTiles: ReadonlySet<number>;

  constructor(map: FoundryMap) {
    this.map = map;
    this.chain = [
      { col: map.entry.col, row: map.entry.row },
      ...map.waypoints.map((w) => ({ col: w.col, row: w.row })),
      { col: map.collector.col, row: map.collector.row },
    ];
    const tiles = new Set<number>();
    for (const wp of map.waypoints) {
      for (const t of platformTiles(wp.col, wp.row)) {
        if (this.inBounds(t.col, t.row)) tiles.add(t.row * GRID_COLS + t.col);
      }
    }
    this.waypointTiles = tiles;
  }

  // ---- Tiles -------------------------------------------------------------

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
  }

  /** Whether a tile lies inside one of the map's fixed housings. */
  isFixed(col: number, row: number): boolean {
    for (const h of this.map.housings) {
      if (col >= h.minCol && col <= h.maxCol && row >= h.minRow && row <= h.maxRow)
        return true;
    }
    return false;
  }

  isWaypointTile(col: number, row: number): boolean {
    return this.waypointTiles.has(row * GRID_COLS + col);
  }

  /** Whether a footprint anchored here fits wholly on the grid. */
  anchorInBounds(col: number, row: number): boolean {
    return col >= 0 && col <= MAX_ANCHOR_COL && row >= 0 && row <= MAX_ANCHOR_ROW;
  }

  /** The four tiles a footprint anchored here covers. */
  footprintTiles(col: number, row: number): TileRef[] {
    return [
      { col, row },
      { col: col + 1, row },
      { col, row: row + 1 },
      { col: col + 1, row: row + 1 },
    ];
  }

  /** Whether a footprint anchored here would cover any waypoint-platform tile. */
  footprintHitsWaypoint(col: number, row: number): boolean {
    for (const t of this.footprintTiles(col, row)) {
      if (this.isWaypointTile(t.col, t.row)) return true;
    }
    return false;
  }

  /**
   * The anchor a pointer at this logical position snaps to: the block is centered on
   * the pointer and clamped to a legal anchor, which is the ghost the cursor draws.
   */
  pixelToAnchor(x: number, y: number): TileRef {
    const col = Math.round((x - GRID_X0) / TILE - 1);
    const row = Math.round((y - GRID_Y0) / TILE - 1);
    return {
      col: clamp(col, 0, MAX_ANCHOR_COL),
      row: clamp(row, 0, MAX_ANCHOR_ROW),
    };
  }

  /** The tile a logical position falls in, clamped to the grid. */
  pixelToTile(x: number, y: number): TileRef {
    const col = Math.floor((x - GRID_X0) / TILE);
    const row = Math.floor((y - GRID_Y0) / TILE);
    return {
      col: clamp(col, 0, GRID_COLS - 1),
      row: clamp(row, 0, GRID_ROWS - 1),
    };
  }

  // ---- Occupancy ---------------------------------------------------------

  occupancy(structures: readonly Structure[]): Occupancy {
    const occ = new Uint8Array(GRID_COLS * GRID_ROWS);
    for (const h of this.map.housings) {
      for (let r = h.minRow; r <= h.maxRow; r++) {
        for (let c = h.minCol; c <= h.maxCol; c++) {
          if (this.inBounds(c, r)) occ[r * GRID_COLS + c] = 2;
        }
      }
    }
    for (const s of structures) {
      for (const t of this.footprintTiles(s.col, s.row)) {
        if (this.inBounds(t.col, t.row)) occ[t.row * GRID_COLS + t.col] = 1;
      }
    }
    return occ;
  }

  /** What a tile is, for drawing. A platform tile is walkable and never buildable. */
  tileStateOf(col: number, row: number, occ: Occupancy): TileState {
    if (!this.inBounds(col, row)) return "fixed";
    const v = occ[row * GRID_COLS + col]!;
    if (v === 2) return "fixed";
    if (v === 1) return "blocked";
    if (this.isWaypointTile(col, row)) return "waypoint";
    return "open";
  }

  isOpenTile(col: number, row: number, occ: Occupancy): boolean {
    return this.inBounds(col, row) && occ[row * GRID_COLS + col] === 0;
  }

  /** Whether all four tiles of a footprint anchored here are open. */
  footprintClear(col: number, row: number, occ: Occupancy): boolean {
    if (!this.anchorInBounds(col, row)) return false;
    return (
      this.isOpenTile(col, row, occ) &&
      this.isOpenTile(col + 1, row, occ) &&
      this.isOpenTile(col, row + 1, occ) &&
      this.isOpenTile(col + 1, row + 1, occ)
    );
  }

  // ---- Pathing -----------------------------------------------------------

  /**
   * The shortest open route between two tiles, as tile centers from the start to the
   * goal inclusive, or `null` when none exists.
   *
   * A* over the open tiles, with the corner-cut rule: a diagonal step is taken only
   * when both of the tiles it cuts between are open too, so a route never slips
   * through the join of two walls.
   */
  pathTiles(from: TileRef, to: TileRef, occ: Occupancy): Pt[] | null {
    const start = from.row * GRID_COLS + from.col;
    const goal = to.row * GRID_COLS + to.col;
    if (!this.isOpenTile(from.col, from.row, occ)) return null;
    if (!this.isOpenTile(to.col, to.row, occ)) return null;
    if (start === goal) return [tileCenter(from.col, from.row)];

    const n = GRID_COLS * GRID_ROWS;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();
    g[start] = 0;
    open.push(start, heuristic(from.col, from.row, to.col, to.row));

    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goal) return reconstruct(came, cur);
      if (closed[cur]) continue;
      closed[cur] = 1;
      const col = cur % GRID_COLS;
      const row = (cur - col) / GRID_COLS;
      const gc = g[cur]!;
      for (const [dc, dr] of ORTHO) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        relax(cur, nc, nr, gc + 1, to, g, came, closed, open);
      }
      for (const [dc, dr] of DIAG) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        if (!this.isOpenTile(col + dc, row, occ)) continue;
        if (!this.isOpenTile(col, row + dr, occ)) continue;
        relax(cur, nc, nr, gc + SQRT2, to, g, came, closed, open);
      }
    }
    return null;
  }

  /**
   * Whether any open route joins two tiles.
   *
   * A flood rather than a full search, because the never-seal rule asks only whether a
   * route exists and not how long it is.
   */
  segmentOpen(from: TileRef, to: TileRef, occ: Occupancy): boolean {
    if (!this.isOpenTile(from.col, from.row, occ)) return false;
    if (!this.isOpenTile(to.col, to.row, occ)) return false;
    const start = from.row * GRID_COLS + from.col;
    const goal = to.row * GRID_COLS + to.col;
    if (start === goal) return true;
    const seen = new Uint8Array(GRID_COLS * GRID_ROWS);
    const queue = [start];
    seen[start] = 1;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      const col = cur % GRID_COLS;
      const row = (cur - col) / GRID_COLS;
      for (const [dc, dr] of ORTHO) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        const ni = nr * GRID_COLS + nc;
        if (seen[ni]) continue;
        if (ni === goal) return true;
        seen[ni] = 1;
        queue.push(ni);
      }
      for (const [dc, dr] of DIAG) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        if (!this.isOpenTile(col + dc, row, occ)) continue;
        if (!this.isOpenTile(col, row + dr, occ)) continue;
        const ni = nr * GRID_COLS + nc;
        if (seen[ni]) continue;
        if (ni === goal) return true;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return false;
  }

  /** Whether every consecutive segment of the chain still has an open route. */
  chainOpen(occ: Occupancy): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      if (!this.segmentOpen(this.chain[i - 1]!, this.chain[i]!, occ)) return false;
    }
    return true;
  }

  /**
   * Whether standing a footprint here would seal the yard: close any segment of the
   * chain, or leave a walking unit with no route to the checkpoint it is heading for.
   */
  wouldSeal(
    col: number,
    row: number,
    structures: readonly Structure[],
    units: readonly Unit[],
  ): boolean {
    const occ = this.occupancy(structures);
    for (const t of this.footprintTiles(col, row)) {
      if (this.inBounds(t.col, t.row)) occ[t.row * GRID_COLS + t.col] = 1;
    }
    if (!this.chainOpen(occ)) return true;
    for (const u of units) {
      if (u.dead || u.flies) continue;
      const at = this.pixelToTile(u.x, u.y);
      const node = this.chain[u.wpIndex];
      if (!node) continue;
      if (!this.segmentOpen(at, node, occ)) return true;
    }
    return false;
  }

  /**
   * Whether a structure may stand at this anchor: on the grid, clear of walls and
   * housings, off every waypoint platform, clear of every walking unit, and not sealing
   * the yard.
   */
  canPlace(
    col: number,
    row: number,
    structures: readonly Structure[],
    units: readonly Unit[],
  ): boolean {
    if (!this.anchorInBounds(col, row)) return false;
    if (this.footprintHitsWaypoint(col, row)) return false;
    const occ = this.occupancy(structures);
    if (!this.footprintClear(col, row, occ)) return false;
    for (const u of units) {
      if (u.dead || u.flies) continue;
      const at = this.pixelToTile(u.x, u.y);
      if (at.col >= col && at.col <= col + 1 && at.row >= row && at.row <= row + 1)
        return false;
    }
    return !this.wouldSeal(col, row, structures, units);
  }

  /**
   * The route a unit at `from` takes to chain node `wpIndex`.
   *
   * A flyer goes straight to the node. A walking unit takes the shortest open route,
   * excluding the tile it already stands in, so the first point is the next step and
   * the last is the node's own center.
   */
  routeFor(from: Pt, wpIndex: number, occ: Occupancy, flying: boolean): Pt[] {
    const node = this.chain[wpIndex];
    if (!node) return [];
    const nodeCenter = tileCenter(node.col, node.row);
    if (flying) return [nodeCenter];
    const fromTile = this.pixelToTile(from.x, from.y);
    const path = this.pathTiles(fromTile, { col: node.col, row: node.row }, occ);
    if (!path || path.length <= 1) return [nodeCenter];
    return path.slice(1);
  }
}

/**
 * The four tiles of a waypoint's platform: the three in a row about the anchor, and one
 * stem tile reaching toward the middle of the grid.
 */
export function platformTiles(col: number, row: number): TileRef[] {
  const stemRow = row < MID_ROW ? row + 1 : row - 1;
  return [
    { col: col - 1, row },
    { col, row },
    { col: col + 1, row },
    { col, row: stemRow },
  ];
}

function heuristic(c0: number, r0: number, c1: number, r1: number): number {
  const dx = Math.abs(c0 - c1);
  const dy = Math.abs(r0 - r1);
  // Octile distance: it matches the two move costs exactly and never overestimates.
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

function relax(
  from: number,
  nc: number,
  nr: number,
  tentative: number,
  to: TileRef,
  g: Float64Array,
  came: Int32Array,
  closed: Uint8Array,
  open: MinHeap,
): void {
  const ni = nr * GRID_COLS + nc;
  if (closed[ni]) return;
  if (tentative >= g[ni]!) return;
  g[ni] = tentative;
  came[ni] = from;
  open.push(ni, tentative + heuristic(nc, nr, to.col, to.row));
}

function reconstruct(came: Int32Array, goal: number): Pt[] {
  const tiles: number[] = [goal];
  let cur = goal;
  while (came[cur] !== -1) {
    cur = came[cur]!;
    tiles.push(cur);
  }
  tiles.reverse();
  return tiles.map((i) => {
    const col = i % GRID_COLS;
    const row = (i - col) / GRID_COLS;
    return tileCenter(col, row);
  });
}

/**
 * The three boards, built once.
 *
 * A board depends on its map alone, and the maps are fixed, so this is a derivation
 * rather than state: nothing here is ever written to, and the world carries the map's
 * identifier rather than the board itself.
 */
const BOARDS: Readonly<Record<MapId, Board>> = Object.fromEntries(
  MAPS.map((m) => [m.id, new Board(m)]),
) as Record<MapId, Board>;

/** The board of a map. */
export function boardOf(map: MapId): Board {
  return BOARDS[map];
}
