// Fathom — the trench maze: parsing, tile queries, the wall autotile bitmask,
// wrap tunnels, pixel<->tile conversion, and the corridor flood used by sonar.

import {
  COLS,
  GATE_COL,
  GATE_ROW,
  GRID_X,
  GRID_Y,
  MAZE,
  ROWS,
  TILE,
  WRAP_ROW,
} from "./constants";
import { Dir, dirVec, Tile } from "./types";

export interface Cell {
  col: number;
  row: number;
}

export class Maze {
  readonly tiles: Tile[][] = [];

  constructor() {
    for (let r = 0; r < ROWS; r++) {
      const row: Tile[] = [];
      const src = MAZE[r];
      for (let c = 0; c < COLS; c++) {
        const ch = src[c];
        row.push(
          ch === "#"
            ? Tile.Wall
            : ch === "D"
              ? Tile.Den
              : ch === "G"
                ? Tile.Gate
                : Tile.Open,
        );
      }
      this.tiles.push(row);
    }
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
  }

  at(c: number, r: number): Tile {
    if (!this.inBounds(c, r)) return Tile.Wall;
    return this.tiles[r][c];
  }

  isWall(c: number, r: number): boolean {
    return this.at(c, r) === Tile.Wall;
  }

  // Open to the forager: corridor tiles only (never den or gate).
  foragerOpen(c: number, r: number): boolean {
    return this.at(c, r) === Tile.Open;
  }

  // Open to a predator: corridors, the den interior, and the gate.
  predOpen(c: number, r: number): boolean {
    const t = this.at(c, r);
    return t === Tile.Open || t === Tile.Den || t === Tile.Gate;
  }

  isDen(c: number, r: number): boolean {
    return this.at(c, r) === Tile.Den;
  }

  // ---- pixel <-> tile ---------------------------------------------------
  static cx(col: number): number {
    return GRID_X + col * TILE + TILE / 2;
  }
  static cy(row: number): number {
    return GRID_Y + row * TILE + TILE / 2;
  }
  static colAt(x: number): number {
    return Math.floor((x - GRID_X) / TILE);
  }
  static rowAt(y: number): number {
    return Math.floor((y - GRID_Y) / TILE);
  }

  // ---- wrap-aware neighbour --------------------------------------------
  // Returns the tile one step in `d` from (col,row), applying the horizontal
  // wrap tunnel at WRAP_ROW.
  step(col: number, row: number, d: Dir): Cell {
    const v = dirVec(d);
    let c = col + v.x;
    const r = row + v.y;
    if (row === WRAP_ROW) {
      if (c < 0) c = COLS - 1;
      else if (c >= COLS) c = 0;
    }
    return { col: c, row: r };
  }

  isWrapEdge(c: number, r: number): boolean {
    return r === WRAP_ROW && (c === 0 || c === COLS - 1);
  }

  // The wall autotile frame index (0..15) for a wall cell: bitmask of which
  // orthogonal sides are also wall (N=1,E=2,S=4,W=8). Out-of-bounds counts as
  // wall so the border merges seamlessly.
  wallFrame(c: number, r: number): number {
    let m = 0;
    if (this.isWall(c, r - 1) || r - 1 < 0) m |= 1; // N
    if (this.isWall(c + 1, r) || c + 1 >= COLS) m |= 2; // E
    if (this.isWall(c, r + 1) || r + 1 >= ROWS) m |= 4; // S
    if (this.isWall(c - 1, r) || c - 1 < 0) m |= 8; // W
    return m;
  }

  isGate(c: number, r: number): boolean {
    return c === GATE_COL && r === GATE_ROW;
  }

  // ---- corridor flood (sonar) ------------------------------------------
  // BFS from (col,row) through predator-open tiles (corridors, gate, den),
  // out to `range` steps. Returns every reached tile. Follows corridors
  // (bends around corners) but never passes through walls. The forager's own
  // start tile is included at step 0.
  flood(col: number, row: number, range: number): Cell[] {
    const seen = new Set<number>();
    const key = (c: number, r: number) => r * COLS + c;
    const out: Cell[] = [];
    let frontier: Cell[] = [{ col, row }];
    seen.add(key(col, row));
    out.push({ col, row });
    for (let step = 0; step < range; step++) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        for (const d of [Dir.Up, Dir.Down, Dir.Left, Dir.Right]) {
          const n = this.step(cell.col, cell.row, d);
          if (!this.inBounds(n.col, n.row)) continue;
          if (this.isWall(n.col, n.row)) continue;
          const k = key(n.col, n.row);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(n);
          out.push(n);
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return out;
  }

  // ---- corridor pathfinding (predator chase) ---------------------------
  // Breadth-first shortest corridor path from (sc,sr) to (tc,tr) through tiles
  // the `canEnter` predicate accepts (wrap-aware, bending around corners), and
  // return the FIRST step direction along it. This is what a hunting predator
  // steers by so it actually rounds walls to its fix instead of stalling in an
  // L-corner the way a greedy "reduce the straight-line distance" step does
  // (specs/predators.md). Returns Dir.None if already there or no path exists.
  firstStepToward(
    sc: number,
    sr: number,
    tc: number,
    tr: number,
    canEnter: (c: number, r: number) => boolean,
  ): Dir {
    if (sc === tc && sr === tr) return Dir.None;
    const key = (c: number, r: number) => r * COLS + c;
    const seen = new Set<number>();
    const firstDir = new Map<number, Dir>();
    seen.add(key(sc, sr));
    let frontier: Cell[] = [{ col: sc, row: sr }];
    while (frontier.length) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        const from = firstDir.get(key(cell.col, cell.row));
        for (const d of [Dir.Up, Dir.Down, Dir.Left, Dir.Right]) {
          const n = this.step(cell.col, cell.row, d);
          if (!this.inBounds(n.col, n.row)) continue;
          if (!canEnter(n.col, n.row)) continue;
          const k = key(n.col, n.row);
          if (seen.has(k)) continue;
          seen.add(k);
          // The first move on the path: the source's own neighbours seed it
          // with `d`; every deeper cell inherits the neighbour it came from.
          const fd = from ?? d;
          if (n.col === tc && n.row === tr) return fd;
          firstDir.set(k, fd);
          next.push(n);
        }
      }
      frontier = next;
    }
    return Dir.None;
  }
}
