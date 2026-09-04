// Fathom — laying out a maze.
//
// Every maze the game plays on is laid out here, off the seeded generator, so a
// dive replayed from the same seed meets the same trench
// (`specs/instrumentation.md`). What comes out satisfies every rule in
// `specs/maze.md`, and `src/maze-rules.ts` is what says so: a candidate that
// breaks a rule is thrown away and another is drawn.
//
// The construction is a maze on a lattice, which is what makes conformance cheap
// to guarantee rather than expensive to search for. Corridor cells sit on the odd
// columns and odd rows of the left half; a link between two neighboring cells
// opens the single tile between them; and the right half is the mirror of the
// left, so the symmetry `specs/maze.md` requires is built in rather than tested
// for. Because a cell is at an odd column and an odd row, and a link tile has one
// odd coordinate and one even one, a tile with two even coordinates is never
// open — which is exactly the condition that makes a 2 x 2 block of corridor
// impossible. What is left to arrange is the den, the wrap tunnel, and braiding
// the dead ends out.

import { GRID_COLS, GRID_ROWS } from "./constants";
import { CORRIDOR, DEN, GATE, ROCK, loadLayout } from "./maze";
import { mazeFaults } from "./maze-rules";
import type { Draws } from "./rng";
import type { MazeState, Tile } from "./state";

/** The columns the left half's corridor cells sit on. */
const CELL_COLS: readonly number[] = [1, 3, 5, 7, 9, 11, 13, 15, 17];
/** The rows every corridor cell sits on. */
const CELL_ROWS: readonly number[] = [1, 3, 5, 7, 9, 11, 13, 15];

/**
 * The left column of the pair the mirror axis runs between. The two center
 * columns are neighbors with no tile between them, so a vertical link there would
 * open a 2 x 2 block against its mirror; the axis column therefore links sideways
 * alone.
 */
const AXIS_COL = 17;

/**
 * The den chamber `specs/maze.md` fixes, and the gate on its top edge.
 *
 * The chamber itself is columns `16` through `19`, rows `7` through `9`. The
 * lattice gives up a wider box than that — a column of it on each side — because
 * the chamber has to be walled: a corridor cell at column `15` would sit against
 * den interior at column `16`, and the den is enclosed.
 */
const DEN_X0 = 16;
const DEN_X1 = 19;
const DEN_Y0 = 7;
const DEN_Y1 = 9;
const WALL_X0 = DEN_X0 - 1;
const WALL_X1 = DEN_X1 + 1;
const GATE_X = 17;
const GATE_Y = DEN_Y0 - 1;

/** The rows the forager's start tile is drawn from (`specs/maze.md`). */
const START_ROW_MIN = 9;
const START_ROW_MAX = 16;

/** How many candidates are drawn before the generator gives up. */
const ATTEMPTS = 32;

interface Link {
  /** The two cells it joins, as indices into the cell list. */
  readonly a: number;
  readonly b: number;
  /** The tile it opens. */
  readonly tx: number;
  readonly ty: number;
}

/** Inside the box the lattice gives up: the chamber and the wall around it. */
function inDen(tx: number, ty: number): boolean {
  return tx >= WALL_X0 && tx <= WALL_X1 && ty >= DEN_Y0 && ty <= DEN_Y1;
}

/** Every cell of the left half, with the ones the den chamber swallows dropped. */
function layOutCells(): {
  readonly cells: Tile[];
  readonly index: Map<number, number>;
} {
  const cells: Tile[] = [];
  const index = new Map<number, number>();
  for (const ty of CELL_ROWS) {
    for (const tx of CELL_COLS) {
      if (inDen(tx, ty)) continue;
      index.set(ty * GRID_COLS + tx, cells.length);
      cells.push({ tx, ty });
    }
  }
  return { cells, index };
}

/** Every link the lattice offers between two surviving cells. */
function layOutLinks(
  cells: readonly Tile[],
  index: Map<number, number>,
): Link[] {
  const links: Link[] = [];
  for (let a = 0; a < cells.length; a++) {
    const cell = cells[a];
    const east = index.get(cell.ty * GRID_COLS + (cell.tx + 2));
    if (east !== undefined) {
      links.push({ a, b: east, tx: cell.tx + 1, ty: cell.ty });
    }
    // The axis column links sideways alone, so its cells never open the tile that
    // would pair with its mirror into a 2 x 2 block.
    if (cell.tx === AXIS_COL) continue;
    const south = index.get((cell.ty + 2) * GRID_COLS + cell.tx);
    if (south !== undefined) {
      links.push({ a, b: south, tx: cell.tx, ty: cell.ty + 1 });
    }
  }
  return links;
}

class Regions {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(node: number): number {
    let root = node;
    while (this.parent[root] !== root) {
      this.parent[root] = this.parent[this.parent[root]];
      root = this.parent[root];
    }
    return root;
  }

  join(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

/** The candidate layout the carved cells and links describe, mirrored and denned. */
function paint(cells: readonly Tile[], carved: ReadonlySet<number>): string[] {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () =>
    new Array<string>(GRID_COLS).fill(ROCK),
  );
  for (const cell of cells) grid[cell.ty][cell.tx] = CORRIDOR;
  for (const key of carved) {
    grid[Math.floor(key / GRID_COLS)][key % GRID_COLS] = CORRIDOR;
  }
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS / 2; tx++) {
      grid[ty][GRID_COLS - 1 - tx] = grid[ty][tx];
    }
  }
  for (let ty = DEN_Y0; ty <= DEN_Y1; ty++) {
    for (let tx = DEN_X0; tx <= DEN_X1; tx++) grid[ty][tx] = DEN;
  }
  grid[GATE_Y][GATE_X] = GATE;
  return grid.map((row) => row.join(""));
}

function corridorDegree(
  rows: readonly string[],
  tx: number,
  ty: number,
): number {
  let degree = 0;
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS) continue;
    if (rows[ny][nx] === CORRIDOR) degree++;
  }
  return degree;
}

/** One candidate layout, and the rows the wrap tunnel may pierce. */
function drawCandidate(draws: Draws): { rows: string[]; wrapRow: number } {
  const { cells, index } = layOutCells();
  const links = layOutLinks(cells, index);
  const regions = new Regions(cells.length);
  const carved = new Set<number>();
  const spare: Link[] = [];

  // Every cell on the axis column links west, so the mirrored pair on the axis is
  // joined to the rest of the maze rather than marooned facing its own reflection.
  const forced = links.filter(
    (link) =>
      cells[link.b].tx === AXIS_COL && cells[link.a].tx === AXIS_COL - 2,
  );
  for (const link of forced) {
    regions.join(link.a, link.b);
    carved.add(link.ty * GRID_COLS + link.tx);
  }

  // A spanning tree over what is left, drawn in a shuffled order: a perfect maze,
  // one tile wide throughout and connected everywhere.
  const rest = links.filter(
    (link) => !carved.has(link.ty * GRID_COLS + link.tx),
  );
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(draws.next() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  for (const link of rest) {
    if (regions.join(link.a, link.b)) carved.add(link.ty * GRID_COLS + link.tx);
    else spare.push(link);
  }

  // Braid: a perfect maze is all dead ends, and `specs/maze.md` allows none, so
  // every cell with fewer than two corridor neighbors takes one more link.
  let rows = paint(cells, carved);
  for (let pass = 0; pass < 8; pass++) {
    let opened = false;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (corridorDegree(rows, cell.tx, cell.ty) >= 2) continue;
      const options = spare.filter(
        (link) =>
          (link.a === i || link.b === i) &&
          !carved.has(link.ty * GRID_COLS + link.tx),
      );
      if (options.length === 0) continue;
      const pick = options[Math.floor(draws.next() * options.length)];
      carved.add(pick.ty * GRID_COLS + pick.tx);
      rows = paint(cells, carved);
      opened = true;
    }
    if (!opened) break;
  }

  // The wrap tunnel: one row clear of the den, pierced at both borders.
  const wrapRows = CELL_ROWS.filter((ty) => ty < DEN_Y0 - 1 || ty > DEN_Y1 + 1);
  const wrapRow = wrapRows[Math.floor(draws.next() * wrapRows.length)];
  const pierced = rows[wrapRow].split("");
  pierced[0] = CORRIDOR;
  pierced[GRID_COLS - 1] = CORRIDOR;
  rows[wrapRow] = pierced.join("");

  return { rows, wrapRow };
}

/** The corridor tiles a start tile may be drawn from (`specs/maze.md`). */
function startCandidates(rows: readonly string[]): Tile[] {
  const tiles: Tile[] = [];
  for (let ty = START_ROW_MIN; ty <= START_ROW_MAX && ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (rows[ty][tx] === CORRIDOR) tiles.push({ tx, ty });
    }
  }
  return tiles;
}

/**
 * A maze that satisfies every rule of `specs/maze.md`, laid out off `draws`.
 *
 * The lattice makes the corridor width, the symmetry and the border certain by
 * construction, and braiding takes the dead ends out; the proportions are the one
 * thing a draw can miss, so a candidate is measured before it is accepted.
 */
export function generateMaze(draws: Draws): MazeState {
  let lastFaults: string[] = [];
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { rows } = drawCandidate(draws);
    const starts = startCandidates(rows);
    if (starts.length === 0) continue;
    const start = starts[Math.floor(draws.next() * starts.length)];
    const maze = loadLayout(rows, start);
    const faults = mazeFaults(maze);
    if (faults.length === 0) return maze;
    lastFaults = faults;
  }
  throw new Error(
    `Fathom: could not lay out a conforming maze in ${ATTEMPTS} attempts — ${lastFaults.join("; ")}`,
  );
}
