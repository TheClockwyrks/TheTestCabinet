// Fathom — the rules every maze the game lays out satisfies (`specs/maze.md`),
// as measurements over a layout.
//
// The generator in `src/maze-generator.ts` lays a maze out and this module says
// whether it conforms, so the rules are stated once and checked rather than
// assumed. A layout posed through the debug surface is a fixture and is exempt
// from all of it, so nothing here runs on a posed board.

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
import { DIRS, onGrid, tileIndex } from "./grid";
import {
  CORRIDOR,
  DEN,
  GATE,
  ROCK,
  corridorTiles,
  isCorridor,
  isRock,
  predatorCanEnter,
  stepTile,
} from "./maze";
import type { MazeState, Tile } from "./state";

/** The cells inside the border, which density is measured against. */
export const INTERIOR_CELLS = (GRID_COLS - 2) * (GRID_ROWS - 2);

/** The three proportions `specs/maze.md` fixes, measured over the corridors. */
export interface MazeMeasures {
  /** The mean number of corridor neighbors per corridor tile. */
  readonly openness: number;
  /** The mean length of a corridor run, in tiles. */
  readonly corridorRun: number;
  /** The corridor tiles over the cells inside the border. */
  readonly density: number;
}

/** Every corridor neighbor of `(tx, ty)`, following the wrap tunnel. */
export function corridorNeighbors(
  maze: MazeState,
  tx: number,
  ty: number,
): Tile[] {
  const out: Tile[] = [];
  for (const dir of DIRS) {
    const n = stepTile(maze, tx, ty, dir);
    if (onGrid(n.tx, n.ty) && isCorridor(maze, n.tx, n.ty)) out.push(n);
  }
  return out;
}

/** The three proportions of `maze`. */
export function measureMaze(maze: MazeState): MazeMeasures {
  const corridors = corridorTiles(maze);
  if (corridors.length === 0) {
    return { openness: 0, corridorRun: 0, density: 0 };
  }

  const degrees = new Map<number, number>();
  let neighborTotal = 0;
  for (const tile of corridors) {
    const degree = corridorNeighbors(maze, tile.tx, tile.ty).length;
    degrees.set(tileIndex(tile.tx, tile.ty), degree);
    neighborTotal += degree;
  }

  // A corridor run is a maximal connected group of corridor tiles that each have
  // exactly two corridor neighbors: the straightaways and bends between one
  // junction and the next.
  const visited = new Set<number>();
  const runs: number[] = [];
  for (const tile of corridors) {
    const key = tileIndex(tile.tx, tile.ty);
    if (degrees.get(key) !== 2 || visited.has(key)) continue;
    visited.add(key);
    let length = 0;
    const stack: Tile[] = [tile];
    for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
      length++;
      for (const n of corridorNeighbors(maze, cell.tx, cell.ty)) {
        const nk = tileIndex(n.tx, n.ty);
        if (degrees.get(nk) !== 2 || visited.has(nk)) continue;
        visited.add(nk);
        stack.push(n);
      }
    }
    runs.push(length);
  }

  return {
    openness: neighborTotal / corridors.length,
    corridorRun:
      runs.length === 0 ? 0 : runs.reduce((a, b) => a + b, 0) / runs.length,
    density: corridors.length / INTERIOR_CELLS,
  };
}

/**
 * Every rule of `specs/maze.md` `maze` breaks, named. An empty list is a
 * conforming maze.
 */
export function mazeFaults(maze: MazeState): string[] {
  const faults: string[] = [];
  const rows = maze.rows;

  // Corridor width: no four corridor tiles form a 2 x 2 block.
  for (let ty = 0; ty < GRID_ROWS - 1; ty++) {
    for (let tx = 0; tx < GRID_COLS - 1; tx++) {
      if (
        isCorridor(maze, tx, ty) &&
        isCorridor(maze, tx + 1, ty) &&
        isCorridor(maze, tx, ty + 1) &&
        isCorridor(maze, tx + 1, ty + 1)
      ) {
        faults.push(`a 2x2 block of corridor at (${tx}, ${ty})`);
      }
    }
  }

  // Mirror symmetry about the axis between the two center columns. A pair is
  // exempt when either of its tiles is den interior or the den gate.
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS / 2; tx++) {
      const near = rows[ty][tx];
      const far = rows[ty][GRID_COLS - 1 - tx];
      if (near === DEN || near === GATE || far === DEN || far === GATE)
        continue;
      if ((near === ROCK) !== (far === ROCK)) {
        faults.push(
          `column ${tx} does not mirror column ${GRID_COLS - 1 - tx} at row ${ty}`,
        );
      }
    }
  }

  // A solid border, apart from the two wrap-tunnel mouths.
  for (let tx = 0; tx < GRID_COLS; tx++) {
    if (!isRock(maze, tx, 0))
      faults.push(`the top border is open at column ${tx}`);
    if (!isRock(maze, tx, GRID_ROWS - 1)) {
      faults.push(`the bottom border is open at column ${tx}`);
    }
  }
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    if (ty === maze.wrapRow) continue;
    if (!isRock(maze, 0, ty))
      faults.push(`the left border is open at row ${ty}`);
    if (!isRock(maze, GRID_COLS - 1, ty)) {
      faults.push(`the right border is open at row ${ty}`);
    }
  }

  const corridors = corridorTiles(maze);
  if (corridors.length === 0) {
    faults.push("the layout has no corridor tile");
    return faults;
  }

  // No dead ends: every corridor tile has at least two corridor neighbors.
  for (const tile of corridors) {
    if (corridorNeighbors(maze, tile.tx, tile.ty).length < 2) {
      faults.push(`a dead end at (${tile.tx}, ${tile.ty})`);
    }
  }

  // One connected region of corridor.
  const reached = new Set<number>([
    tileIndex(corridors[0].tx, corridors[0].ty),
  ]);
  const stack: Tile[] = [corridors[0]];
  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    for (const n of corridorNeighbors(maze, cell.tx, cell.ty)) {
      const key = tileIndex(n.tx, n.ty);
      if (reached.has(key)) continue;
      reached.add(key);
      stack.push(n);
    }
  }
  if (reached.size !== corridors.length) {
    faults.push(
      `the corridors fall into more than one region (${reached.size} of ${corridors.length} reachable)`,
    );
  }
  if (!reached.has(tileIndex(maze.start.tx, maze.start.ty))) {
    faults.push("the forager's start tile is outside the connected region");
  }

  // The wrap tunnel: exactly one pierced row, carrying no den tile and no gate.
  let pierced = 0;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    if (rows[ty][0] === CORRIDOR && rows[ty][GRID_COLS - 1] === CORRIDOR)
      pierced++;
  }
  if (pierced !== 1)
    faults.push(`${pierced} rows pierce the border, expected exactly one`);
  if (maze.wrapRow >= 0) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const ch = rows[maze.wrapRow][tx];
      if (ch === DEN || ch === GATE) {
        faults.push(`the wrap-tunnel row carries a den tile at column ${tx}`);
      }
    }
  }

  // The den: enclosed, with exactly one gate on its top edge, and reachable.
  if (maze.denTiles.length === 0) faults.push("the maze has no den chamber");
  if (maze.gate === null) faults.push("the maze has no den gate");
  for (const tile of maze.denTiles) {
    if (corridorNeighbors(maze, tile.tx, tile.ty).length > 0) {
      faults.push(
        `the den tile (${tile.tx}, ${tile.ty}) opens straight onto a corridor`,
      );
    }
  }
  const gate = maze.gate;
  if (
    gate !== null &&
    !maze.denTiles.some((t) => t.tx === gate.tx && t.ty === gate.ty + 1)
  ) {
    faults.push("the den gate is not on the chamber's top edge");
  }
  if (maze.denTiles.length > 0) {
    // Following corridor, den and gate tiles alike, the start tile is reachable
    // from every den-interior tile, so a released predator can reach the forager.
    const denReached = new Set<number>();
    const denStack: Tile[] = [maze.denTiles[0]];
    denReached.add(tileIndex(maze.denTiles[0].tx, maze.denTiles[0].ty));
    for (let cell = denStack.pop(); cell !== undefined; cell = denStack.pop()) {
      for (const dir of DIRS) {
        const n = stepTile(maze, cell.tx, cell.ty, dir);
        if (!onGrid(n.tx, n.ty) || !predatorCanEnter(maze, n.tx, n.ty))
          continue;
        const key = tileIndex(n.tx, n.ty);
        if (denReached.has(key)) continue;
        denReached.add(key);
        denStack.push(n);
      }
    }
    for (const tile of maze.denTiles) {
      if (!denReached.has(tileIndex(tile.tx, tile.ty))) {
        faults.push(
          `the den tile (${tile.tx}, ${tile.ty}) is cut off from the rest of the chamber`,
        );
      }
    }
    if (!denReached.has(tileIndex(maze.start.tx, maze.start.ty))) {
      faults.push("the forager's start tile is unreachable from the den");
    }
  }

  // The forager's start tile: a corridor tile in the lower half of the grid.
  if (!isCorridor(maze, maze.start.tx, maze.start.ty)) {
    faults.push("the forager's start tile is not a corridor tile");
  }
  if (maze.start.ty < 9 || maze.start.ty > 16) {
    faults.push(
      `the forager's start tile is on row ${maze.start.ty}, outside rows 9 through 16`,
    );
  }

  // The three proportions.
  const measures = measureMaze(maze);
  if (
    measures.openness < MAZE_OPENNESS_MIN ||
    measures.openness > MAZE_OPENNESS_MAX
  ) {
    faults.push(
      `openness ${measures.openness.toFixed(3)} is outside [${MAZE_OPENNESS_MIN}, ${MAZE_OPENNESS_MAX}]`,
    );
  }
  if (
    measures.corridorRun < MAZE_MAZING_MIN ||
    measures.corridorRun > MAZE_MAZING_MAX
  ) {
    faults.push(
      `corridor run ${measures.corridorRun.toFixed(3)} is outside [${MAZE_MAZING_MIN}, ${MAZE_MAZING_MAX}]`,
    );
  }
  if (
    measures.density < MAZE_DENSITY_MIN ||
    measures.density > MAZE_DENSITY_MAX
  ) {
    faults.push(
      `density ${measures.density.toFixed(3)} is outside [${MAZE_DENSITY_MIN}, ${MAZE_DENSITY_MAX}]`,
    );
  }

  return faults;
}

/** Whether `maze` satisfies every rule of `specs/maze.md`. */
export function mazeConforms(maze: MazeState): boolean {
  return mazeFaults(maze).length === 0;
}
