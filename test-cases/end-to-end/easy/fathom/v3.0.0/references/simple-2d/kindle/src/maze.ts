// Fathom — the maze: loading a layout, the tile queries every system asks of it,
// the wall autotile mask, the corridor flood a sonar wavefront travels, and the
// corridor pathfinding a hunter steers by (`specs/maze.md`).
//
// A layout is held in exactly the alphabet the snapshot reports and the debug
// surface's `setMaze` accepts, so the board the game plays on and the board a
// scenario poses are the same value. Everything else on `MazeState` — the wrap
// row, the gate, the den tiles — is read off that layout when it is loaded rather
// than carried beside it, so a posed fixture brings its own structures with it
// and nothing can fall out of step.

import { GRID_COLS, GRID_ROWS } from "./constants";
import { DIRS, dirStep, onGrid } from "./grid";
import type { Dir, Heading, MazeState, Tile } from "./state";

/** Rock, solid trench wall. */
export const ROCK = "#";
/** Corridor, flooded open water. */
export const CORRIDOR = ".";
/** The den gate. */
export const GATE = "g";
/** Den interior. */
export const DEN = "d";

const ALPHABET = new Set([ROCK, CORRIDOR, GATE, DEN]);

/**
 * Why `rows` is not a layout, or `null` when it is one.
 *
 * `specs/instrumentation.md` fixes the three ways a posed layout is invalid: the
 * wrong size, a character outside the alphabet, and den tiles without exactly one
 * gate. Nothing else is checked here, because a posed fixture is exempt from
 * every rule in `specs/maze.md`.
 */
export function layoutProblem(rows: readonly string[]): string | null {
  if (rows.length !== GRID_ROWS) {
    return `expected ${GRID_ROWS} rows, received ${rows.length}`;
  }
  let gates = 0;
  let dens = 0;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    const row = rows[ty];
    if (row.length !== GRID_COLS) {
      return `row ${ty} has ${row.length} characters, expected ${GRID_COLS}`;
    }
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const ch = row[tx];
      if (!ALPHABET.has(ch)) {
        return `unknown tile character ${JSON.stringify(ch)} at (${tx}, ${ty})`;
      }
      if (ch === GATE) gates++;
      if (ch === DEN) dens++;
    }
  }
  if ((gates > 0 || dens > 0) && gates !== 1) {
    return `a layout with a den must carry exactly one gate, found ${gates}`;
  }
  return null;
}

/** The first corridor tile in reading order, or `null` on a layout with none. */
export function firstCorridor(rows: readonly string[]): Tile | null {
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (rows[ty][tx] === CORRIDOR) return { tx, ty };
    }
  }
  return null;
}

/**
 * `rows` as a loaded maze, with its wrap row, gate and den read off it.
 *
 * `start` fixes the forager's resting tile. Without one it is the first corridor
 * tile in reading order, which is what a posed fixture gets
 * (`specs/instrumentation.md`).
 */
export function loadLayout(rows: readonly string[], start?: Tile): MazeState {
  const problem = layoutProblem(rows);
  if (problem !== null)
    throw new Error(`Fathom: invalid maze layout — ${problem}`);

  let wrapRow = -1;
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    if (rows[ty][0] === CORRIDOR && rows[ty][GRID_COLS - 1] === CORRIDOR) {
      wrapRow = ty;
      break;
    }
  }

  let gate: Tile | null = null;
  const denTiles: Tile[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      const ch = rows[ty][tx];
      if (ch === DEN) denTiles.push({ tx, ty });
      if (ch === GATE) gate = { tx, ty };
    }
  }

  const resolved = start ?? firstCorridor(rows);
  if (resolved === null) {
    throw new Error(
      "Fathom: invalid maze layout — the layout has no corridor tile",
    );
  }

  return { rows: [...rows], wrapRow, gate, denTiles, start: resolved };
}

/** The character at `(tx, ty)`. Everything off the grid is rock. */
export function tileAt(maze: MazeState, tx: number, ty: number): string {
  return onGrid(tx, ty) ? maze.rows[ty][tx] : ROCK;
}

export function isRock(maze: MazeState, tx: number, ty: number): boolean {
  return tileAt(maze, tx, ty) === ROCK;
}

export function isCorridor(maze: MazeState, tx: number, ty: number): boolean {
  return tileAt(maze, tx, ty) === CORRIDOR;
}

export function isDen(maze: MazeState, tx: number, ty: number): boolean {
  return tileAt(maze, tx, ty) === DEN;
}

export function isGate(maze: MazeState, tx: number, ty: number): boolean {
  return tileAt(maze, tx, ty) === GATE;
}

/** Open to the forager: corridor tiles alone, never the den or its gate. */
export function foragerCanEnter(
  maze: MazeState,
  tx: number,
  ty: number,
): boolean {
  return isCorridor(maze, tx, ty);
}

/** Open to a predator: corridors, the den interior, and the gate. */
export function predatorCanEnter(
  maze: MazeState,
  tx: number,
  ty: number,
): boolean {
  const ch = tileAt(maze, tx, ty);
  return ch === CORRIDOR || ch === DEN || ch === GATE;
}

/**
 * The tile one step in `dir` from `(tx, ty)`, applying the wrap tunnel on the
 * loaded layout's pierced row.
 */
export function stepTile(
  maze: MazeState,
  tx: number,
  ty: number,
  dir: Dir,
): Tile {
  const { dx, dy } = dirStep(dir);
  let nx = tx + dx;
  const ny = ty + dy;
  if (ty === maze.wrapRow) {
    if (nx < 0) nx = GRID_COLS - 1;
    else if (nx >= GRID_COLS) nx = 0;
  }
  return { tx: nx, ty: ny };
}

/** Whether `(tx, ty)` is one of the two mouths of the wrap tunnel. */
export function isWrapMouth(maze: MazeState, tx: number, ty: number): boolean {
  return ty === maze.wrapRow && (tx === 0 || tx === GRID_COLS - 1);
}

/**
 * The autotile frame a rock tile is drawn from: a bitmask of which orthogonal
 * sides are also rock (N = 1, E = 2, S = 4, W = 8), as `specs/assets.md` defines
 * it. Off the grid counts as rock, so the border merges seamlessly.
 */
export function wallMask(maze: MazeState, tx: number, ty: number): number {
  let mask = 0;
  if (isRock(maze, tx, ty - 1)) mask |= 1;
  if (isRock(maze, tx + 1, ty)) mask |= 2;
  if (isRock(maze, tx, ty + 1)) mask |= 4;
  if (isRock(maze, tx - 1, ty)) mask |= 8;
  return mask;
}

/** Every corridor tile of the layout, in reading order. */
export function corridorTiles(maze: MazeState): Tile[] {
  const tiles: Tile[] = [];
  for (let ty = 0; ty < GRID_ROWS; ty++) {
    for (let tx = 0; tx < GRID_COLS; tx++) {
      if (maze.rows[ty][tx] === CORRIDOR) tiles.push({ tx, ty });
    }
  }
  return tiles;
}

/**
 * The corridor flood from `(tx, ty)`, out to `range` steps, grouped by corridor
 * distance: index `d` holds every tile reached in exactly `d` steps, and index
 * `0` holds the origin alone.
 *
 * Because the depth of a breadth-first search IS the shortest corridor distance,
 * this is the geometry of a sonar wavefront — the tiles the front arrives at each
 * moment as it travels out along the trench, bending at bends and entering no
 * space rock seals off (`specs/sensing.md`).
 */
export function floodBuckets(
  maze: MazeState,
  tx: number,
  ty: number,
  range: number,
): Tile[][] {
  const seen = new Set<number>([ty * GRID_COLS + tx]);
  const buckets: Tile[][] = [[{ tx, ty }]];
  let frontier: Tile[] = [{ tx, ty }];
  for (let step = 0; step < range; step++) {
    const next: Tile[] = [];
    for (const cell of frontier) {
      for (const dir of DIRS) {
        const n = stepTile(maze, cell.tx, cell.ty, dir);
        if (!onGrid(n.tx, n.ty) || isRock(maze, n.tx, n.ty)) continue;
        const key = n.ty * GRID_COLS + n.tx;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(n);
      }
    }
    if (next.length === 0) break;
    buckets.push(next);
    frontier = next;
  }
  return buckets;
}

/**
 * The first step of a shortest corridor route from `(sx, sy)` to `(gx, gy)`
 * through the tiles `canEnter` accepts, or `null` when the route is already run
 * or no route exists.
 *
 * This is what a hunter holding a fix steers by, so it takes the way around an
 * obstacle rather than wedging in the corner nearest its fix
 * (`specs/predators.md`).
 */
export function firstStepToward(
  maze: MazeState,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  canEnter: (tx: number, ty: number) => boolean,
): Heading {
  if (sx === gx && sy === gy) return null;
  const seen = new Set<number>([sy * GRID_COLS + sx]);
  const opening = new Map<number, Dir>();
  let frontier: Tile[] = [{ tx: sx, ty: sy }];
  while (frontier.length > 0) {
    const next: Tile[] = [];
    for (const cell of frontier) {
      const from = opening.get(cell.ty * GRID_COLS + cell.tx);
      for (const dir of DIRS) {
        const n = stepTile(maze, cell.tx, cell.ty, dir);
        if (!onGrid(n.tx, n.ty) || !canEnter(n.tx, n.ty)) continue;
        const key = n.ty * GRID_COLS + n.tx;
        if (seen.has(key)) continue;
        seen.add(key);
        const opened = from ?? dir;
        if (n.tx === gx && n.ty === gy) return opened;
        opening.set(key, opened);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
