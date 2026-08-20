// Fathom — the trench maze: parsing, tile queries, the wall autotile bitmask,
// wrap tunnels, pixel<->tile conversion, and the corridor flood used by sonar.

import {
  COLS,
  GRID_X,
  GRID_Y,
  MAZE,
  START_COL,
  START_ROW,
  ROWS,
  TILE,
} from "./constants";
import { Dir, dirVec, Tile } from "./types";

export interface Cell {
  col: number;
  row: number;
}

export class Maze {
  tiles: Tile[][] = [];

  // Derived from whatever layout is loaded rather than fixed in constants, so a posed
  // layout (`setMaze`, specs/instrumentation.md) brings its own den, gate and wrap
  // tunnel with it. -1 means the layout has none.
  wrapRow = -1;
  gateCol = -1;
  gateRow = -1;
  /** Where the forager stands on a fresh trench. */
  startCol = START_COL;
  startRow = START_ROW;
  /** Every den-interior tile, in reading order: the parking slots. */
  denTiles: Cell[] = [];

  constructor() {
    this.load(MAZE, { col: START_COL, row: START_ROW });
  }

  /**
   * Replace the layout. `rows` is the `snapshot().tiles` form — one string per row,
   * `'#'` wall, `'.'` corridor, `'g'`/`'G'` the den gate, `'d'`/`'D'` den interior.
   * `start` fixes the forager's resting tile; without one it is the first corridor
   * tile in reading order, as a posed layout gets.
   */
  load(rows: readonly string[], start?: Cell): void {
    if (rows.length !== ROWS) {
      throw new Error(
        `setMaze: expected ${ROWS} rows, received ${rows.length}`,
      );
    }
    this.tiles = [];
    for (let r = 0; r < ROWS; r++) {
      const src = rows[r];
      if (src.length !== COLS) {
        throw new Error(
          `setMaze: row ${r} has ${src.length} characters, expected ${COLS}`,
        );
      }
      const row: Tile[] = [];
      for (let c = 0; c < COLS; c++) {
        const ch = src[c];
        const tile =
          ch === "#"
            ? Tile.Wall
            : ch === "."
              ? Tile.Open
              : ch === "d" || ch === "D"
                ? Tile.Den
                : ch === "g" || ch === "G"
                  ? Tile.Gate
                  : null;
        if (tile === null) {
          throw new Error(
            `setMaze: unknown tile character ${JSON.stringify(ch)} at (${c}, ${r})`,
          );
        }
        row.push(tile);
      }
      this.tiles.push(row);
    }

    this.wrapRow = -1;
    for (let r = 0; r < ROWS; r++) {
      if (this.tiles[r][0] !== Tile.Open) continue;
      if (this.tiles[r][COLS - 1] !== Tile.Open) continue;
      if (this.wrapRow >= 0) {
        throw new Error(
          `setMaze: rows ${this.wrapRow} and ${r} both pierce the border; at most one wrap tunnel is allowed`,
        );
      }
      this.wrapRow = r;
    }

    this.gateCol = -1;
    this.gateRow = -1;
    this.denTiles = [];
    let gates = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.tiles[r][c] === Tile.Den) this.denTiles.push({ col: c, row: r });
        if (this.tiles[r][c] !== Tile.Gate) continue;
        gates++;
        this.gateCol = c;
        this.gateRow = r;
      }
    }
    if (gates > 1 || (gates === 0 && this.denTiles.length > 0)) {
      throw new Error(
        `setMaze: a layout with a den must carry exactly one gate, found ${gates}`,
      );
    }

    if (start) {
      this.startCol = start.col;
      this.startRow = start.row;
    } else {
      const first = this.firstOpen();
      if (!first) throw new Error("setMaze: the layout has no corridor tile");
      this.startCol = first.col;
      this.startRow = first.row;
    }
  }

  /** The first corridor tile in reading order, or null on a layout with none. */
  firstOpen(): Cell | null {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.tiles[r][c] === Tile.Open) return { col: c, row: r };
      }
    }
    return null;
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
  // wrap tunnel on the loaded layout's wrap row.
  step(col: number, row: number, d: Dir): Cell {
    const v = dirVec(d);
    let c = col + v.x;
    const r = row + v.y;
    if (row === this.wrapRow) {
      if (c < 0) c = COLS - 1;
      else if (c >= COLS) c = 0;
    }
    return { col: c, row: r };
  }

  isWrapEdge(c: number, r: number): boolean {
    return r === this.wrapRow && (c === 0 || c === COLS - 1);
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
    return c === this.gateCol && r === this.gateRow;
  }

  // ---- corridor flood (sonar) ------------------------------------------
  // BFS from (col,row) through open corridor tiles, out to `range` steps, grouped
  // by BFS depth: the return value's index `d` holds every tile reached in exactly
  // `d` corridor steps. Follows corridors (bends around corners) but never passes
  // through walls. Because BFS depth is the shortest corridor distance from the
  // origin, this is the geometry of a sonar wavefront — the set of tiles the pulse
  // reaches at each "moment" as it travels out and reflects along the trench
  // (specs/sensing.md). Index 0 is the origin tile alone.
  floodBuckets(col: number, row: number, range: number): Cell[][] {
    const seen = new Set<number>();
    const key = (c: number, r: number) => r * COLS + c;
    const buckets: Cell[][] = [[{ col, row }]];
    seen.add(key(col, row));
    let frontier: Cell[] = [{ col, row }];
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
        }
      }
      if (!next.length) break;
      buckets.push(next);
      frontier = next;
    }
    return buckets;
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
