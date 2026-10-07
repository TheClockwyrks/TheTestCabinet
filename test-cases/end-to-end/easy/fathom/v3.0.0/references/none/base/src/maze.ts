// Fathom — the trench maze.
//
// Owns the layout the game plays on: parsing it, the tile queries the rest of
// the build asks, the wrap-aware neighbor step, the wall autotile bitmask, the
// corridor flood a sonar wavefront travels along, and the corridor pathfinding a
// hunter steers by. It also carries the structural measures `specs/maze.md`
// fixes, so the shipped layout is checked against them by this build's own
// tests rather than asserted by hand.

import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
} from "./constants";
import type { Cell, Dir, TileKind } from "./types";
import { DIRS, dirStep } from "./types";

/**
 * The layout this build ships, in the alphabet the snapshot's `tiles` reports:
 * `#` rock, `.` corridor, `d` den interior, `g` the den gate. It is one maze
 * reused at every depth, which `specs/progression.md` allows, and it satisfies
 * every rule of `specs/maze.md` — a solid border pierced only by the wrap
 * tunnel on row 13, mirror symmetry about the axis between columns 17 and 18,
 * one-tile-wide corridors with no dead end, one connected region, and a single
 * enclosed den chamber whose only opening is the gate above it.
 */
export const SHIPPED_LAYOUT: readonly string[] = [
  "####################################",
  "#..................................#",
  "#.###.#.#######.####.#######.#.###.#",
  "#.....#.....#..........#.....#.....#",
  "#.#######.#.#.#.####.#.#.#.#######.#",
  "#.........#...#......#...#.........#",
  "###.#.#.#####.###g####.#####.#.#.###",
  "#...#.#.....#.##dddd##.#.....#.#...#",
  "#.#.#.#####.#.##dddd##.#.#####.#.#.#",
  "#.#.......#...##dddd##...#.......#.#",
  "#.###.###.################.###.###.#",
  "#...#..........................#...#",
  "#.#.#.#####.############.#####.#.#.#",
  "..#.#.......#..........#.......#.#..",
  "#.#.###.#.###.#.####.#.###.#.###.#.#",
  "#.......#.....#......#.....#.......#",
  "####################################",
  "####################################",
];

/** Where the forager rests on the shipped layout, in the grid's lower half. */
export const SHIPPED_START: Cell = { col: 17, row: 15 };

/** The den slots predators are parked on, filling the chamber outward. */
const DEN_SLOTS: readonly Cell[] = [
  { col: 17, row: 8 },
  { col: 18, row: 8 },
  { col: 16, row: 8 },
  { col: 19, row: 8 },
  { col: 17, row: 7 },
  { col: 18, row: 7 },
];

const KIND_OF: Readonly<Record<string, TileKind>> = {
  "#": "rock",
  ".": "corridor",
  g: "gate",
  d: "den",
};

const CHAR_OF: Readonly<Record<TileKind, string>> = {
  rock: "#",
  corridor: ".",
  gate: "g",
  den: "d",
};

/** Whether a tile may be entered, asked of each candidate step. */
export type CanEnter = (col: number, row: number) => boolean;

export class Maze {
  /** One row per grid row, one kind per column. */
  private kinds: TileKind[][] = [];

  /**
   * The row the wrap tunnel pierces, or `-1` on a layout with none. It is read
   * off whatever layout is loaded rather than fixed, because a posed fixture
   * brings its own tunnel — or none at all.
   */
  wrapRow = -1;

  /** The single den gate, or `null` on a layout with no den. */
  gate: Cell | null = null;

  /** Every den-interior tile, in reading order. */
  denTiles: Cell[] = [];

  /** Where the forager rests on a fresh maze. */
  start: Cell = { ...SHIPPED_START };

  constructor() {
    this.load(SHIPPED_LAYOUT, SHIPPED_START);
  }

  /**
   * Replace the layout. `rows` is the snapshot's `tiles` form. `start` fixes the
   * forager's resting tile; without one it is the first corridor tile in reading
   * order, which is what a posed fixture gets.
   *
   * A layout of the wrong size, carrying a character outside the alphabet, or
   * carrying den or gate tiles without exactly one gate, is invalid and throws.
   * Nothing else is refused: a fixture is exempt from every rule of
   * `specs/maze.md`, so dead ends, wide corridors, asymmetry, several pierced
   * rows and a missing den are all loaded as given.
   */
  load(rows: readonly string[], start?: Cell): void {
    if (rows.length !== GRID_ROWS) {
      throw new Error(
        `maze layout: expected ${GRID_ROWS} rows, received ${rows.length}`,
      );
    }
    const kinds: TileKind[][] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      const src = rows[r];
      if (src.length !== GRID_COLS) {
        throw new Error(
          `maze layout: row ${r} has ${src.length} characters, expected ${GRID_COLS}`,
        );
      }
      const row: TileKind[] = [];
      for (let c = 0; c < GRID_COLS; c++) {
        const kind = KIND_OF[src[c]];
        if (kind === undefined) {
          throw new Error(
            `maze layout: unknown tile character ${JSON.stringify(src[c])} at (${c}, ${r})`,
          );
        }
        row.push(kind);
      }
      kinds.push(row);
    }

    const gates: Cell[] = [];
    const dens: Cell[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (kinds[r][c] === "gate") gates.push({ col: c, row: r });
        else if (kinds[r][c] === "den") dens.push({ col: c, row: r });
      }
    }
    if ((gates.length > 0 || dens.length > 0) && gates.length !== 1) {
      throw new Error(
        `maze layout: a layout with a den must carry exactly one gate, found ${gates.length}`,
      );
    }

    this.kinds = kinds;
    this.gate = gates[0] ?? null;
    this.denTiles = dens;

    // The first row whose two border tiles are both open is the wrap tunnel; a
    // fixture that pierces several rows simply uses the topmost.
    this.wrapRow = -1;
    for (let r = 0; r < GRID_ROWS; r++) {
      if (
        kinds[r][0] === "corridor" &&
        kinds[r][GRID_COLS - 1] === "corridor"
      ) {
        this.wrapRow = r;
        break;
      }
    }

    this.start = start ? { ...start } : (this.firstCorridor() ?? this.start);
  }

  /** The layout as the snapshot reports it, one string per row. */
  rows(): string[] {
    return this.kinds.map((row) => row.map((k) => CHAR_OF[k]).join(""));
  }

  /** The first corridor tile in reading order, or `null` on a layout with none. */
  firstCorridor(): Cell | null {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.kinds[r][c] === "corridor") return { col: c, row: r };
      }
    }
    return null;
  }

  /**
   * The den tiles predators are parked on, in order. The chamber's own tiles are
   * preferred in a fixed order so the roster fills it from the middle outward; a
   * fixture whose den sits elsewhere falls back to its own den tiles.
   */
  denSlots(): Cell[] {
    const preferred = DEN_SLOTS.filter((t) => this.isDen(t.col, t.row));
    return preferred.length > 0
      ? preferred.map((t) => ({ ...t }))
      : this.denTiles.map((t) => ({ ...t }));
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
  }

  /** The kind of a tile. Everything off the grid reads as rock. */
  at(col: number, row: number): TileKind {
    return this.inBounds(col, row) ? this.kinds[row][col] : "rock";
  }

  isRock(col: number, row: number): boolean {
    return this.at(col, row) === "rock";
  }

  isDen(col: number, row: number): boolean {
    return this.at(col, row) === "den";
  }

  isGate(col: number, row: number): boolean {
    return this.at(col, row) === "gate";
  }

  /** Open to the forager and to a predator out of the den: corridor alone. */
  isCorridor(col: number, row: number): boolean {
    return this.at(col, row) === "corridor";
  }

  /** Open to a predator inside the den: corridor, the chamber, and the gate. */
  isDenOpen(col: number, row: number): boolean {
    const kind = this.at(col, row);
    return kind === "corridor" || kind === "den" || kind === "gate";
  }

  /** Whether a tile is one of the wrap tunnel's two mouths. */
  isWrapMouth(col: number, row: number): boolean {
    return row === this.wrapRow && (col === 0 || col === GRID_COLS - 1);
  }

  // ---- logical units <-> tiles -------------------------------------------

  static centerX(col: number): number {
    return GRID_ORIGIN_X + col * TILE + TILE / 2;
  }

  static centerY(row: number): number {
    return GRID_ORIGIN_Y + row * TILE + TILE / 2;
  }

  static colAt(x: number): number {
    return Math.floor((x - GRID_ORIGIN_X) / TILE);
  }

  static rowAt(y: number): number {
    return Math.floor((y - GRID_ORIGIN_Y) / TILE);
  }

  // ---- neighbors ---------------------------------------------------------

  /**
   * The tile one step in `d` from `(col, row)`, wrapping across the tunnel's two
   * mouths on the pierced row. The result may be off the grid, which `at` reads
   * as rock.
   */
  step(col: number, row: number, d: Dir): Cell {
    const v = dirStep(d);
    let c = col + v.col;
    const r = row + v.row;
    if (row === this.wrapRow) {
      if (c < 0) c = GRID_COLS - 1;
      else if (c >= GRID_COLS) c = 0;
    }
    return { col: c, row: r };
  }

  /** Every neighbor of a tile, the wrap tunnel's extra pair included. */
  neighbors(col: number, row: number): Cell[] {
    return DIRS.map((d) => this.step(col, row, d)).filter((n) =>
      this.inBounds(n.col, n.row),
    );
  }

  /** How many of a tile's neighbors are corridor. */
  corridorNeighborCount(col: number, row: number): number {
    return this.neighbors(col, row).filter((n) => this.isCorridor(n.col, n.row))
      .length;
  }

  /**
   * The wall autotile frame index for a rock tile: one bit per orthogonal
   * neighbor that is also rock, N=1, E=2, S=4, W=8. Off the grid counts as rock,
   * so the border merges seamlessly. This deliberately ignores the wrap tunnel:
   * the two mouths are drawn as the board's own edges rather than stitched.
   */
  wallFrame(col: number, row: number): number {
    let mask = 0;
    if (this.rockOrOutside(col, row - 1)) mask |= 1;
    if (this.rockOrOutside(col + 1, row)) mask |= 2;
    if (this.rockOrOutside(col, row + 1)) mask |= 4;
    if (this.rockOrOutside(col - 1, row)) mask |= 8;
    return mask;
  }

  private rockOrOutside(col: number, row: number): boolean {
    return !this.inBounds(col, row) || this.isRock(col, row);
  }

  // ---- the corridor flood a wavefront travels -----------------------------

  /**
   * Breadth-first from `(col, row)` through corridor tiles out to `range` steps,
   * grouped by depth: index `d` holds every tile reached in exactly `d` corridor
   * steps, and index `0` is the origin alone. Because breadth-first depth is the
   * shortest corridor distance, this is the geometry of a sonar wavefront — the
   * tiles the pulse reaches at each moment as it flows down the trench, bending
   * at bends and stopping at rock.
   */
  floodBuckets(col: number, row: number, range: number): Cell[][] {
    const seen = new Set<number>([this.key(col, row)]);
    const buckets: Cell[][] = [[{ col, row }]];
    let frontier: Cell[] = buckets[0];
    for (let step = 0; step < range; step++) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        for (const d of DIRS) {
          const n = this.step(cell.col, cell.row, d);
          if (!this.inBounds(n.col, n.row)) continue;
          if (this.isRock(n.col, n.row)) continue;
          const k = this.key(n.col, n.row);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(n);
        }
      }
      if (next.length === 0) break;
      buckets.push(next);
      frontier = next;
    }
    return buckets;
  }

  // ---- the route a hunter steers by ---------------------------------------

  /**
   * The first step of a shortest corridor route from `(sc, sr)` to `(tc, tr)`
   * through tiles `canEnter` accepts, so a hunter rounds the rock between it and
   * its fix instead of wedging in a corner. `null` when it is already there or
   * no route exists.
   */
  firstStepToward(
    sc: number,
    sr: number,
    tc: number,
    tr: number,
    canEnter: CanEnter,
  ): Dir | null {
    if (sc === tc && sr === tr) return null;
    const seen = new Set<number>([this.key(sc, sr)]);
    const firstDir = new Map<number, Dir>();
    let frontier: Cell[] = [{ col: sc, row: sr }];
    while (frontier.length > 0) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        const from = firstDir.get(this.key(cell.col, cell.row));
        for (const d of DIRS) {
          const n = this.step(cell.col, cell.row, d);
          if (!this.inBounds(n.col, n.row)) continue;
          if (!canEnter(n.col, n.row)) continue;
          const k = this.key(n.col, n.row);
          if (seen.has(k)) continue;
          seen.add(k);
          const opening = from ?? d;
          if (n.col === tc && n.row === tr) return opening;
          firstDir.set(k, opening);
          next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** Every corridor tile reachable from `(col, row)` along corridor neighbors. */
  corridorRegion(col: number, row: number): Set<number> {
    const seen = new Set<number>();
    if (!this.isCorridor(col, row)) return seen;
    seen.add(this.key(col, row));
    let frontier: Cell[] = [{ col, row }];
    while (frontier.length > 0) {
      const next: Cell[] = [];
      for (const cell of frontier) {
        for (const n of this.neighbors(cell.col, cell.row)) {
          if (!this.isCorridor(n.col, n.row)) continue;
          const k = this.key(n.col, n.row);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(n);
        }
      }
      frontier = next;
    }
    return seen;
  }

  /** Every corridor tile of the layout, in reading order. */
  corridorTiles(): Cell[] {
    const out: Cell[] = [];
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.kinds[r][c] === "corridor") out.push({ col: c, row: r });
      }
    }
    return out;
  }

  /** A tile's index in row-major order, the key every set here is built on. */
  key(col: number, row: number): number {
    return row * GRID_COLS + col;
  }
}

// ---- the structural measures `specs/maze.md` fixes -------------------------

/** The mean number of corridor neighbors per corridor tile. */
export function openness(maze: Maze): number {
  const tiles = maze.corridorTiles();
  if (tiles.length === 0) return 0;
  let total = 0;
  for (const t of tiles) total += maze.corridorNeighborCount(t.col, t.row);
  return total / tiles.length;
}

/** Corridor tiles as a fraction of the cells inside the border. */
export function density(maze: Maze): number {
  return maze.corridorTiles().length / ((GRID_COLS - 2) * (GRID_ROWS - 2));
}

/**
 * The mean length of a corridor run: a maximal connected group of corridor
 * tiles that each have exactly two corridor neighbors, which is the straightaway
 * or bend between one junction and the next.
 */
export function meanCorridorRun(maze: Maze): number {
  const inRun = new Map<number, Cell>();
  for (const t of maze.corridorTiles()) {
    if (maze.corridorNeighborCount(t.col, t.row) === 2) {
      inRun.set(maze.key(t.col, t.row), t);
    }
  }
  const visited = new Set<number>();
  const lengths: number[] = [];
  for (const [k, cell] of inRun) {
    if (visited.has(k)) continue;
    visited.add(k);
    let length = 0;
    const stack: Cell[] = [cell];
    while (stack.length > 0) {
      const current = stack.pop() as Cell;
      length++;
      for (const n of maze.neighbors(current.col, current.row)) {
        const nk = maze.key(n.col, n.row);
        if (!inRun.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        stack.push(inRun.get(nk) as Cell);
      }
    }
    lengths.push(length);
  }
  if (lengths.length === 0) return 0;
  return lengths.reduce((a, b) => a + b, 0) / lengths.length;
}
