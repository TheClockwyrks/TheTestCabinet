// Arc Foundry — the tile grid, the ordered-waypoint pathing, and placement legality
// (specs/board.md).
//
// The yard is a 50×33 grid of 20 px tiles (specs/board.md §2.2). Each map defines an
// ORDERED waypoint chain [entry, WP1…WPk, collector]; a non-flying unit heads to each
// node in sequence, taking the shortest OPEN route (grid A*, with the diagonal corner-cut
// rule) around the walls between consecutive nodes. Every component, candidate, and blocker
// is a 2×2 wall; Map C adds fixed housings that are impassable AND never buildable. Each
// waypoint is a 4-tile T-shaped PLATFORM — walkable but never buildable — so a waypoint can
// never be walled off. A placement is REFUSED if it would seal any chain segment, trap a
// walking unit, or cover a platform tile (the never-seal rule); the floor re-paths live.
//
// The Board is DOM-free and pure over its (map, structures) inputs, so the browser and the
// headless balance harness drive it identically.

import {
  GRID_COLS,
  GRID_ROWS,
  GRID_X0,
  GRID_Y0,
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  TILE,
  tileCenter,
} from "./constants";
import type { MapDef, Pt, Structure, TileCoord, TileState, Unit } from "./types";

// A per-tile occupancy snapshot derived from the current structure set + the map's fixed
// housings: 0 = open, 1 = blocked (a removable wall), 2 = fixed (a housing). Indexed
// row-major as `occ[row * GRID_COLS + col]`.
export type Occupancy = Uint8Array;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// The eight step directions (orthogonal then diagonal), with move cost.
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const SQRT2 = Math.SQRT2;

// A tiny binary min-heap over tile indices keyed by A* f-score.
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

export class Board {
  readonly map: MapDef;
  // The full ordered pathing chain: [entry, ...waypoints, collector] (specs/board.md §3.1).
  readonly chain: TileCoord[];
  // The tiles of every waypoint PLATFORM (walkable but never buildable), as row*COLS+col.
  readonly waypointTiles: Set<number>;

  constructor(map: MapDef) {
    this.map = map;
    this.chain = [map.entry, ...map.waypoints, map.collector];
    this.waypointTiles = new Set();
    for (const wp of map.waypoints) {
      for (const t of this.platformTiles(wp.col, wp.row)) {
        if (this.inBounds(t.col, t.row)) this.waypointTiles.add(t.row * GRID_COLS + t.col);
      }
    }
  }

  // The 4 tiles of a waypoint's T-shaped platform (specs/board.md): the three-in-a-row
  // (c−1,r), (c,r), (c+1,r) and one stem tile toward the board's vertical center (row 16).
  platformTiles(col: number, row: number): TileCoord[] {
    const stemRow = row < 16 ? row + 1 : row - 1;
    return [
      { col: col - 1, row },
      { col, row },
      { col: col + 1, row },
      { col, row: stemRow },
    ];
  }
  isWaypointTile(col: number, row: number): boolean {
    return this.waypointTiles.has(row * GRID_COLS + col);
  }
  // Would a 2×2 footprint anchored at (col, row) cover any waypoint-platform tile?
  footprintHitsWaypoint(col: number, row: number): boolean {
    for (const t of this.footprintTiles(col, row)) {
      if (this.isWaypointTile(t.col, t.row)) return true;
    }
    return false;
  }

  get cols(): number {
    return GRID_COLS;
  }
  get rows(): number {
    return GRID_ROWS;
  }

  // ---- Tiles ------------------------------------------------------------------

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
  }
  // Is (col, row) inside one of the map's fixed transformer housings (Map C)?
  isFixed(col: number, row: number): boolean {
    for (const h of this.map.housings) {
      if (col >= h.col0 && col <= h.col1 && row >= h.row0 && row <= h.row1) return true;
    }
    return false;
  }
  // Does a 2×2 footprint anchored at (col, row) fit on the grid (col 0..48, row 0..31)?
  anchorInBounds(col: number, row: number): boolean {
    return col >= 0 && col <= MAX_ANCHOR_COL && row >= 0 && row <= MAX_ANCHOR_ROW;
  }
  // The four tiles a 2×2 footprint anchored at (col, row) covers.
  footprintTiles(col: number, row: number): TileCoord[] {
    return [
      { col, row },
      { col: col + 1, row },
      { col, row: row + 1 },
      { col: col + 1, row: row + 1 },
    ];
  }
  // Snap a logical-pixel pointer to the 2×2 footprint's top-left anchor tile (the ghost):
  // the block is centered on the cursor, clamped to a legal anchor.
  pixelToAnchor(x: number, y: number): TileCoord {
    const col = Math.round((x - GRID_X0) / TILE - 1);
    const row = Math.round((y - GRID_Y0) / TILE - 1);
    return { col: clamp(col, 0, MAX_ANCHOR_COL), row: clamp(row, 0, MAX_ANCHOR_ROW) };
  }
  // The tile a logical-pixel point falls in (clamped to the grid).
  pixelToTile(x: number, y: number): TileCoord {
    const col = Math.floor((x - GRID_X0) / TILE);
    const row = Math.floor((y - GRID_Y0) / TILE);
    return { col: clamp(col, 0, GRID_COLS - 1), row: clamp(row, 0, GRID_ROWS - 1) };
  }

  // ---- Occupancy --------------------------------------------------------------

  occupancy(structures: Structure[]): Occupancy {
    const occ = new Uint8Array(GRID_COLS * GRID_ROWS);
    for (const h of this.map.housings) {
      for (let r = h.row0; r <= h.row1; r++) {
        for (let c = h.col0; c <= h.col1; c++) {
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
  tileStateOf(col: number, row: number, occ: Occupancy): TileState {
    if (!this.inBounds(col, row)) return "fixed";
    const v = occ[row * GRID_COLS + col]!;
    if (v === 2) return "fixed";
    if (v === 1) return "blocked";
    // Waypoint-platform tiles are walkable (occ 0 for pathing) but render as a platform and
    // are never buildable.
    if (this.isWaypointTile(col, row)) return "waypoint";
    return "open";
  }
  isOpenTile(col: number, row: number, occ: Occupancy): boolean {
    return this.inBounds(col, row) && occ[row * GRID_COLS + col] === 0;
  }
  // Are all four tiles of a 2×2 footprint open (in bounds, not blocked/fixed)?
  footprintClear(col: number, row: number, occ: Occupancy): boolean {
    if (!this.anchorInBounds(col, row)) return false;
    return (
      this.isOpenTile(col, row, occ) &&
      this.isOpenTile(col + 1, row, occ) &&
      this.isOpenTile(col, row + 1, occ) &&
      this.isOpenTile(col + 1, row + 1, occ)
    );
  }

  // ---- Pathing ----------------------------------------------------------------

  // Grid A* between two tiles over the open tiles, honouring the diagonal corner-cut rule
  // (§3.3): a diagonal step is allowed only when both orthogonally-adjacent tiles are also
  // open. Returns the route as tile-center points (start..goal inclusive), or null.
  pathTiles(from: TileCoord, to: TileCoord, occ: Occupancy): Pt[] | null {
    const start = from.row * GRID_COLS + from.col;
    const goal = to.row * GRID_COLS + to.col;
    if (!this.isOpenTile(from.col, from.row, occ) || !this.isOpenTile(to.col, to.row, occ)) return null;
    if (start === goal) return [tileCenter(from.col, from.row)];

    const n = GRID_COLS * GRID_ROWS;
    const g = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();
    g[start] = 0;
    open.push(start, this.heuristic(from.col, from.row, to.col, to.row));

    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goal) return this.reconstruct(came, cur);
      if (closed[cur]) continue;
      closed[cur] = 1;
      const col = cur % GRID_COLS;
      const row = (cur - col) / GRID_COLS;
      const gc = g[cur]!;
      // Orthogonal neighbours (cost 1).
      for (const [dc, dr] of ORTHO) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        this.relax(cur, nc, nr, gc + 1, to, g, came, closed, open);
      }
      // Diagonal neighbours (cost √2), gated on both cut tiles being open.
      for (const [dc, dr] of DIAG) {
        const nc = col + dc;
        const nr = row + dr;
        if (!this.isOpenTile(nc, nr, occ)) continue;
        if (!this.isOpenTile(col + dc, row, occ) || !this.isOpenTile(col, row + dr, occ)) continue;
        this.relax(cur, nc, nr, gc + SQRT2, to, g, came, closed, open);
      }
    }
    return null;
  }

  private relax(
    from: number,
    nc: number,
    nr: number,
    tentative: number,
    to: TileCoord,
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
    open.push(ni, tentative + this.heuristic(nc, nr, to.col, to.row));
  }

  private heuristic(c0: number, r0: number, c1: number, r1: number): number {
    const dx = Math.abs(c0 - c1);
    const dy = Math.abs(r0 - r1);
    // Octile distance (matches the orthogonal/diagonal move costs), never over-estimating.
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  }

  private reconstruct(came: Int32Array, goal: number): Pt[] {
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

  // Is there any open route between two tiles? A BFS reachability flood (cheaper than a
  // full A*) honouring the diagonal corner-cut rule — used by the never-seal checks.
  segmentOpen(from: TileCoord, to: TileCoord, occ: Occupancy): boolean {
    if (!this.isOpenTile(from.col, from.row, occ) || !this.isOpenTile(to.col, to.row, occ)) return false;
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
        if (!this.isOpenTile(col + dc, row, occ) || !this.isOpenTile(col, row + dr, occ)) continue;
        const ni = nr * GRID_COLS + nc;
        if (seen[ni]) continue;
        if (ni === goal) return true;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return false;
  }

  // Does EVERY consecutive segment of the waypoint chain still have an open route?
  chainOpen(occ: Occupancy): boolean {
    for (let i = 1; i < this.chain.length; i++) {
      if (!this.segmentOpen(this.chain[i - 1]!, this.chain[i]!, occ)) return false;
    }
    return true;
  }

  // The never-seal test (§3.4): would placing a 2×2 at (col, row) block any chain segment,
  // or strand a walking unit with no route to its next waypoint?
  wouldSeal(col: number, row: number, structures: Structure[], units: Unit[]): boolean {
    const occ = this.occupancy(structures);
    // Overlay the hypothetical footprint.
    for (const t of this.footprintTiles(col, row)) {
      if (this.inBounds(t.col, t.row)) occ[t.row * GRID_COLS + t.col] = 1;
    }
    if (!this.chainOpen(occ)) return true;
    // Trap test: every live ground unit must keep a route to its next chain node.
    for (const u of units) {
      if (u.dead || u.flies) continue;
      const ut = this.pixelToTile(u.x, u.y);
      const node = this.chain[u.wpIndex];
      if (!node) continue;
      if (!this.segmentOpen(ut, node, occ)) return true;
    }
    return false;
  }

  // A full legality check for a dropped rock: in bounds, footprint clear of walls/housings,
  // not covering a waypoint platform, clear of any live ground unit, and not sealing the maze
  // (specs/board.md placement).
  canPlace(col: number, row: number, structures: Structure[], units: Unit[]): boolean {
    if (!this.anchorInBounds(col, row)) return false;
    if (this.footprintHitsWaypoint(col, row)) return false;
    const occ = this.occupancy(structures);
    if (!this.footprintClear(col, row, occ)) return false;
    for (const u of units) {
      if (u.dead || u.flies) continue;
      const ut = this.pixelToTile(u.x, u.y);
      if (ut.col >= col && ut.col <= col + 1 && ut.row >= row && ut.row <= row + 1) return false;
    }
    return !this.wouldSeal(col, row, structures, units);
  }

  // The current-leg route for a unit at `from` heading to chain node `wpIndex`; flyers get a
  // straight line to the node (they ignore the maze, §3.6). Re-derived on every re-path. The
  // returned route excludes the unit's current tile — route[0] is the next step to walk to,
  // and the last point is the target node's center.
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

  // The nearest legal 2×2 anchor to (col, row), searched outward on expanding rings — used
  // by the headless balance harness, whose declarative layouts name approximate anchors (the
  // browser places exactly at the snapped pointer instead).
  nearestLegalAnchor(col: number, row: number, structures: Structure[], units: Unit[]): TileCoord | null {
    if (this.canPlace(col, row, structures, units)) return { col, row };
    for (let r = 1; r <= Math.max(GRID_COLS, GRID_ROWS); r++) {
      for (let dc = -r; dc <= r; dc++) {
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue; // ring shell only
          const c = col + dc;
          const rr = row + dr;
          if (this.canPlace(c, rr, structures, units)) return { col: c, row: rr };
        }
      }
    }
    return null;
  }
}
