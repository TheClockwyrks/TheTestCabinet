// Meltdown — the reactor floor grid, tower occupancy, pathfinding, and the
// mazing / can't-seal rules (specs/playfield.md).
//
// Tiles are indexed r * COLS + c. A tile is "open" (walkable by the surge) when
// it is in bounds and not blocked by a tower footprint; intakes and exhausts are
// open too (the surge walks through them). Distance fields are computed with
// Dijkstra (orthogonal cost 1, diagonal cost sqrt2) honouring the corner-cut
// rule: a diagonal step is allowed only when both orthogonally-adjacent tiles it
// cuts past are open, so the surge never squeezes a diagonal gap between two
// diagonally-touching towers.

import {
  BOTTOM_EXHAUST_COLS,
  COLS,
  LEFT_INTAKE_ROWS,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  TILE,
  TOP_INTAKE_COLS,
} from "./constants";

const SQRT2 = Math.SQRT2;
const N = COLS * ROWS;

export type PortalKind = "left-intake" | "top-intake" | "right-exhaust" | "bottom-exhaust";

export interface Portal {
  kind: PortalKind;
  tiles: number[]; // tile indices
}

export function idx(c: number, r: number): number {
  return r * COLS + c;
}
export function colOf(i: number): number {
  return i % COLS;
}
export function rowOf(i: number): number {
  return Math.floor(i / COLS);
}
export function tileCenter(c: number, r: number): { x: number; y: number } {
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 };
}
export function tileAtPixel(x: number, y: number): { c: number; r: number } {
  return {
    c: Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE))),
    r: Math.max(0, Math.min(ROWS - 1, Math.floor(y / TILE))),
  };
}

// Diagonal offsets and the two orthogonal tiles each cuts past.
const DIRS: Array<{ dc: number; dr: number; diag: boolean }> = [
  { dc: 1, dr: 0, diag: false },
  { dc: -1, dr: 0, diag: false },
  { dc: 0, dr: 1, diag: false },
  { dc: 0, dr: -1, diag: false },
  { dc: 1, dr: 1, diag: true },
  { dc: 1, dr: -1, diag: true },
  { dc: -1, dr: 1, diag: true },
  { dc: -1, dr: -1, diag: true },
];

// A minimal binary min-heap over tile indices keyed by a dist array.
class MinHeap {
  private items: number[] = [];
  constructor(private dist: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.dist[a[p]] <= this.dist[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1;
        const r = 2 * p + 2;
        let s = p;
        if (l < a.length && this.dist[a[l]] < this.dist[a[s]]) s = l;
        if (r < a.length && this.dist[a[r]] < this.dist[a[s]]) s = r;
        if (s === p) break;
        [a[p], a[s]] = [a[s], a[p]];
        p = s;
      }
    }
    return top;
  }
}

export class Grid {
  readonly blocked = new Uint8Array(N);
  readonly portalKind = new Int8Array(N).fill(-1); // -1 = none, else PortalKind index

  readonly leftIntake: Portal;
  readonly topIntake: Portal;
  readonly rightExhaust: Portal;
  readonly bottomExhaust: Portal;

  constructor() {
    const leftTiles = LEFT_INTAKE_ROWS.map((r) => idx(0, r));
    const topTiles = TOP_INTAKE_COLS.map((c) => idx(c, 0));
    const rightTiles = RIGHT_EXHAUST_ROWS.map((r) => idx(COLS - 1, r));
    const bottomTiles = BOTTOM_EXHAUST_COLS.map((c) => idx(c, ROWS - 1));
    this.leftIntake = { kind: "left-intake", tiles: leftTiles };
    this.topIntake = { kind: "top-intake", tiles: topTiles };
    this.rightExhaust = { kind: "right-exhaust", tiles: rightTiles };
    this.bottomExhaust = { kind: "bottom-exhaust", tiles: bottomTiles };
    leftTiles.forEach((i) => (this.portalKind[i] = 0));
    topTiles.forEach((i) => (this.portalKind[i] = 1));
    rightTiles.forEach((i) => (this.portalKind[i] = 2));
    bottomTiles.forEach((i) => (this.portalKind[i] = 3));
  }

  isPortal(i: number): boolean {
    return this.portalKind[i] >= 0;
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  // Open for pathing: in bounds and not blocked (intakes/exhausts are open).
  // `extra` optionally treats a set of tile indices as blocked (tentative
  // placement preview / seal check).
  isOpen(c: number, r: number, extra?: Set<number>): boolean {
    if (!this.inBounds(c, r)) return false;
    const i = idx(c, r);
    if (this.blocked[i]) return false;
    if (extra && extra.has(i)) return false;
    return true;
  }

  // The four tiles of a 2x2 footprint centred on intersection (i, j).
  footprintTiles(i: number, j: number): number[] {
    return [idx(i - 1, j - 1), idx(i, j - 1), idx(i - 1, j), idx(i, j)];
  }

  // Dijkstra distance field to a set of goal tiles, honouring corner rules.
  distanceField(goals: number[], extra?: Set<number>): Float64Array {
    const dist = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap(dist);
    for (const g of goals) {
      // A goal that has been blocked is not a valid target.
      if (this.blocked[g] || (extra && extra.has(g))) continue;
      dist[g] = 0;
      heap.push(g);
    }
    while (heap.size > 0) {
      const cur = heap.pop();
      const cc = colOf(cur);
      const cr = rowOf(cur);
      const d = dist[cur];
      for (const dir of DIRS) {
        const nc = cc + dir.dc;
        const nr = cr + dir.dr;
        if (!this.isOpen(nc, nr, extra)) continue;
        if (dir.diag) {
          // corner rule: both cut-past orthogonal tiles must be open
          if (!this.isOpen(cc + dir.dc, cr, extra)) continue;
          if (!this.isOpen(cc, cr + dir.dr, extra)) continue;
        }
        const ni = idx(nc, nr);
        const nd = d + (dir.diag ? SQRT2 : 1);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          heap.push(ni);
        }
      }
    }
    return dist;
  }

  // Reachability flood (unit costs) from goal tiles — used by the seal check.
  reachable(goals: number[], extra?: Set<number>): Uint8Array {
    const seen = new Uint8Array(N);
    const queue: number[] = [];
    for (const g of goals) {
      if (this.blocked[g] || (extra && extra.has(g))) continue;
      seen[g] = 1;
      queue.push(g);
    }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cc = colOf(cur);
      const cr = rowOf(cur);
      for (const dir of DIRS) {
        const nc = cc + dir.dc;
        const nr = cr + dir.dr;
        if (!this.isOpen(nc, nr, extra)) continue;
        if (dir.diag) {
          if (!this.isOpen(cc + dir.dc, cr, extra)) continue;
          if (!this.isOpen(cc, cr + dir.dr, extra)) continue;
        }
        const ni = idx(nc, nr);
        if (!seen[ni]) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    return seen;
  }

  // The best next tile from `from` following a distance field down its gradient
  // (min dist[neighbour] + edge cost). Returns null if no downhill step exists.
  bestNext(fromC: number, fromR: number, field: Float64Array): { c: number; r: number } | null {
    let best: { c: number; r: number } | null = null;
    let bestScore = Infinity;
    for (const dir of DIRS) {
      const nc = fromC + dir.dc;
      const nr = fromR + dir.dr;
      if (!this.isOpen(nc, nr)) continue;
      if (dir.diag) {
        if (!this.isOpen(fromC + dir.dc, fromR)) continue;
        if (!this.isOpen(fromC, fromR + dir.dr)) continue;
      }
      const nd = field[idx(nc, nr)];
      if (!isFinite(nd)) continue;
      const score = nd + (dir.diag ? SQRT2 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = { c: nc, r: nr };
      }
    }
    return best;
  }
}
