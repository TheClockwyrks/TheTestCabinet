// Fathom — the measures a laid-out maze is held to.
//
// `specs/maze.md` fixes what every maze the game lays out satisfies: corridors
// one tile wide, mirror symmetry, a solid border pierced only by the wrap
// tunnel, no dead ends, one connected corridor region, an enclosed den reached
// through a single gate, and three proportions. This module states each of them
// as a measurement of a standing layout, and `faultsOf` reports the ones a
// layout breaks. A posed fixture is exempt from all of it, so nothing here runs
// during play — the trench this build ships is held to it by its own tests.

import {
  GRID_COLS,
  GRID_ROWS,
  MAZE_DENSITY_MAX,
  MAZE_DENSITY_MIN,
  MAZE_MAZING_MAX,
  MAZE_MAZING_MIN,
  MAZE_OPENNESS_MAX,
  MAZE_OPENNESS_MIN,
} from "./constants";
import type { Cell } from "./grid";
import { DIRS, cellIndex } from "./grid";
import type { Maze } from "./maze";

/** The cells inside the border, which density is measured against. */
export const INTERIOR_CELLS = (GRID_COLS - 2) * (GRID_ROWS - 2);

/** Every corridor tile of the layout, in reading order. */
export function corridorTiles(maze: Maze): Cell[] {
  const out: Cell[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (maze.isCorridor(tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** How many neighbors of a tile are corridor, the wrap pair included. */
export function corridorNeighbors(maze: Maze, cell: Cell): number {
  return maze.exits(cell.tx, cell.ty, maze.openToForager).length;
}

/** The mean number of corridor neighbors per corridor tile. */
export function openness(maze: Maze): number {
  const tiles = corridorTiles(maze);
  if (tiles.length === 0) return 0;
  let total = 0;
  for (const cell of tiles) total += corridorNeighbors(maze, cell);
  return total / tiles.length;
}

/** Corridor tiles over the cells inside the border. */
export function density(maze: Maze): number {
  return corridorTiles(maze).length / INTERIOR_CELLS;
}

/**
 * The mean length of a corridor run: a maximal connected group of corridor
 * tiles that each have exactly two corridor neighbors, which is the
 * straightaways and bends between one junction and the next.
 */
export function meanCorridorRun(maze: Maze): number {
  const straight = new Set<number>();
  for (const cell of corridorTiles(maze)) {
    if (corridorNeighbors(maze, cell) === 2) {
      straight.add(cellIndex(cell.tx, cell.ty));
    }
  }
  const seen = new Set<number>();
  const lengths: number[] = [];
  for (const cell of corridorTiles(maze)) {
    const key = cellIndex(cell.tx, cell.ty);
    if (!straight.has(key) || seen.has(key)) continue;
    seen.add(key);
    let length = 0;
    const stack: Cell[] = [cell];
    while (stack.length > 0) {
      const here = stack.pop() as Cell;
      length += 1;
      for (const dir of DIRS) {
        const next = maze.step(here.tx, here.ty, dir);
        const nextKey = cellIndex(next.tx, next.ty);
        if (!straight.has(nextKey) || seen.has(nextKey)) continue;
        seen.add(nextKey);
        stack.push(next);
      }
    }
    lengths.push(length);
  }
  if (lengths.length === 0) return 0;
  let total = 0;
  for (const length of lengths) total += length;
  return total / lengths.length;
}

/** Corridor tiles with fewer than two corridor neighbors. */
export function deadEnds(maze: Maze): Cell[] {
  return corridorTiles(maze).filter(
    (cell) => corridorNeighbors(maze, cell) < 2,
  );
}

/** The top-left corner of every `2 x 2` block of four corridor tiles. */
export function openSquares(maze: Maze): Cell[] {
  const out: Cell[] = [];
  for (let ty = 0; ty < GRID_ROWS - 1; ty++) {
    for (let tx = 0; tx < GRID_COLS - 1; tx++) {
      if (
        maze.isCorridor(tx, ty) &&
        maze.isCorridor(tx + 1, ty) &&
        maze.isCorridor(tx, ty + 1) &&
        maze.isCorridor(tx + 1, ty + 1)
      ) {
        out.push({ tx, ty });
      }
    }
  }
  return out;
}

/**
 * Mirrored pairs that disagree about being rock. A pair is exempt when either
 * of its tiles is den interior or the den gate.
 */
export function symmetryMismatches(maze: Maze): Cell[] {
  const out: Cell[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS / 2; tx++) {
      const mx = GRID_COLS - 1 - tx;
      const here = maze.at(tx, ty);
      const there = maze.at(mx, ty);
      if (here === "d" || here === "g" || there === "d" || there === "g") {
        continue;
      }
      if ((here === "#") !== (there === "#")) out.push({ tx, ty });
    }
  }
  return out;
}

/** Border tiles that are not rock and are not a mouth of the wrap tunnel. */
export function borderBreaches(maze: Maze): Cell[] {
  const out: Cell[] = [];
  const edge = (tx: number, ty: number): void => {
    if (maze.isRock(tx, ty) || maze.isWrapMouth(tx, ty)) return;
    out.push({ tx, ty });
  };
  for (let tx = 0; tx < GRID_COLS; tx++) {
    edge(tx, 0);
    edge(tx, GRID_ROWS - 1);
  }
  for (let ty = 1; ty < GRID_ROWS - 1; ty++) {
    edge(0, ty);
    edge(GRID_COLS - 1, ty);
  }
  return out;
}

/** Every tile reachable from `from` through tiles `open` accepts. */
function reach(
  maze: Maze,
  from: Cell,
  open: (tx: number, ty: number) => boolean,
): Set<number> {
  const seen = new Set<number>([cellIndex(from.tx, from.ty)]);
  const stack: Cell[] = [from];
  while (stack.length > 0) {
    const here = stack.pop() as Cell;
    for (const dir of DIRS) {
      const next = maze.step(here.tx, here.ty, dir);
      if (!open(next.tx, next.ty)) continue;
      const key = cellIndex(next.tx, next.ty);
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(next);
    }
  }
  return seen;
}

/** Whether every corridor tile is reachable from every other. */
export function corridorsConnected(maze: Maze): boolean {
  const tiles = corridorTiles(maze);
  if (tiles.length === 0) return true;
  return reach(maze, tiles[0], maze.openToForager).size === tiles.length;
}

/** Whether the forager's start tile is reachable from every den tile. */
export function denReachesStart(maze: Maze): boolean {
  const start = maze.start;
  return maze.denTiles.every((den) => {
    const seen = reach(maze, den, maze.openToPredator);
    return seen.has(cellIndex(start.tx, start.ty));
  });
}

/** Whether no den tile has a corridor neighbor, so the gate is the one way in. */
export function denEnclosed(maze: Maze): boolean {
  return maze.denTiles.every((den) => corridorNeighbors(maze, den) === 0);
}

/** Whether a row carries any den-interior tile or the den gate. */
function denOnRow(maze: Maze, ty: number): boolean {
  for (let tx = 0; tx < GRID_COLS; tx++) {
    if (maze.isDen(tx, ty) || maze.isGate(tx, ty)) return true;
  }
  return false;
}

/**
 * Every rule of `specs/maze.md` a layout breaks, named. An empty list is a
 * conforming maze.
 */
export function faultsOf(maze: Maze): string[] {
  const faults: string[] = [];

  const squares = openSquares(maze);
  if (squares.length > 0) {
    faults.push(`${squares.length} corridor tiles form a 2x2 block`);
  }

  const mirrored = symmetryMismatches(maze);
  if (mirrored.length > 0) {
    faults.push(`${mirrored.length} mirrored pairs disagree`);
  }

  const breaches = borderBreaches(maze);
  if (breaches.length > 0) {
    faults.push(`${breaches.length} border tiles are not rock`);
  }

  const ends = deadEnds(maze);
  if (ends.length > 0)
    faults.push(`${ends.length} corridor tiles are dead ends`);

  if (!corridorsConnected(maze)) {
    faults.push("the corridors are not one connected region");
  }

  if (maze.wrapRow < 0) faults.push("no row is pierced by a wrap tunnel");
  else if (denOnRow(maze, maze.wrapRow)) {
    faults.push("the pierced row carries the den");
  }

  if (maze.denTiles.length === 0) faults.push("the layout carries no den");
  if (!maze.gate) faults.push("the layout carries no den gate");
  else if (!maze.isDen(maze.gate.tx, maze.gate.ty + 1)) {
    faults.push("the den gate is not on the chamber's top edge");
  }
  if (!denEnclosed(maze)) faults.push("a den tile has a corridor neighbor");
  if (!denReachesStart(maze)) faults.push("the den does not reach the start");

  if (!maze.isCorridor(maze.start.tx, maze.start.ty)) {
    faults.push("the start tile is not corridor");
  } else if (maze.start.ty < GRID_ROWS / 2 || maze.start.ty > GRID_ROWS - 2) {
    faults.push("the start tile is not in the lower half of the grid");
  }

  const spread = openness(maze);
  if (spread < MAZE_OPENNESS_MIN || spread > MAZE_OPENNESS_MAX) {
    faults.push(`openness ${spread.toFixed(3)} is out of range`);
  }

  const run = meanCorridorRun(maze);
  if (run < MAZE_MAZING_MIN || run > MAZE_MAZING_MAX) {
    faults.push(`the mean corridor run ${run.toFixed(3)} is out of range`);
  }

  const packed = density(maze);
  if (packed < MAZE_DENSITY_MIN || packed > MAZE_DENSITY_MAX) {
    faults.push(`density ${packed.toFixed(3)} is out of range`);
  }

  return faults;
}
