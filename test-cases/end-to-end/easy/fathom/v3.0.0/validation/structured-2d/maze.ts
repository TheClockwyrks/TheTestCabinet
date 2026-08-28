// Fathom — the maze oracle. CASE-PROVIDED, and SHARED BYTE-IDENTICALLY across
// `validation/none/`, `validation/simple-2d/` and `validation/structured-2d/`.
//
// This module is specs/maze.md written as measurements. It reads a board — the
// `grid` frame and the `tiles` layout a snapshot reports — and answers the
// questions that file asks of every maze the game lays out for itself: are the
// corridors one tile wide, do the columns mirror, is every corridor tile
// reachable from every other, are there dead ends, and do the three proportions
// land inside their stated bounds.
//
// WHY THESE READ THE BUILD'S OWN BOARD. Nearly every other scenario in this suite
// poses the geometry it is about through `setMaze` (see `fixtures.ts`), because
// what a build's own maze happens to offer is not something a check should turn
// on. The eight `maze/*` points are the exception: FINDING these properties in
// the board the build laid out for itself IS the check, and a posed fixture is
// explicitly exempt from every rule here (specs/instrumentation.md). So these
// functions take a board and never pose one.
//
// It imports nothing of the build and nothing of any engine, which is what lets
// the three engine directories carry the same file. The three proportion bounds
// are restated here from specs/maze.md rather than imported from a build's
// `src/constants.ts`, because the engineless project ships no source at all.

/** The four cardinal directions, in the order every sweep below walks them. */
export const DIRS = ["up", "down", "left", "right"] as const;

/** One of those four. */
export type Dir = (typeof DIRS)[number];

/** The column/row step each direction takes. */
export const STEP: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The direction that undoes each direction. */
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The tile alphabet `snapshot().tiles` and `setMaze` both use. */
export const ROCK = "#";
export const CORRIDOR = ".";
export const GATE = "g";
export const DEN = "d";

/** The three visibility characters `snapshot().visibility` reports. */
export const UNREVEALED = "u";
export const REMEMBERED = "r";
export const LIT = "l";

/**
 * The tile grid's frame, as `snapshot().grid` reports it.
 *
 * Declared here rather than imported from a `surface.ts`, because this file is
 * shared with the engineless project, which has none. Every engine's snapshot
 * satisfies it structurally.
 */
export interface GridFrame {
  cols: number;
  rows: number;
  tile: number;
  originX: number;
  originY: number;
}

/** The whole of a board a structural measure reads. */
export interface BoardView {
  grid: GridFrame;
  tiles: readonly string[];
}

/** One tile, by column and row. */
export interface Tile {
  tx: number;
  ty: number;
}

/* -------------------------------------------------------------------------- */
/* Bounds restated from specs/maze.md                                          */
/* -------------------------------------------------------------------------- */
//
// Each is the figure that file's proportions table gives, under the name
// `src/constants.ts` gives it, so a check that fails on one names the spec's own
// constant. Both bounds of each are inclusive.

/** Mean corridor neighbors per corridor tile (`MAZE_OPENNESS_MIN/MAX`). */
export const MAZE_OPENNESS_MIN = 2.0;
export const MAZE_OPENNESS_MAX = 2.8;

/** Mean corridor run length, in tiles (`MAZE_MAZING_MIN/MAX`). */
export const MAZE_MAZING_MIN = 2.0;
export const MAZE_MAZING_MAX = 8.0;

/** Corridor tiles over the interior cells (`MAZE_DENSITY_MIN/MAX`). */
export const MAZE_DENSITY_MIN = 0.4;
export const MAZE_DENSITY_MAX = 1.0;

/* -------------------------------------------------------------------------- */
/* Reading one tile                                                           */
/* -------------------------------------------------------------------------- */

/** The character at `(tx, ty)`, or `undefined` off the board. */
export function tileAt(
  board: BoardView,
  tx: number,
  ty: number,
): string | undefined {
  return board.tiles[ty]?.[tx];
}

/** The tile is open corridor: the only kind the forager travels. */
export function isCorridor(board: BoardView, tx: number, ty: number): boolean {
  return tileAt(board, tx, ty) === CORRIDOR;
}

/** The tile is rock, or off the board, which is solid to every body alike. */
export function isRock(board: BoardView, tx: number, ty: number): boolean {
  const at = tileAt(board, tx, ty);
  return at === undefined || at === ROCK;
}

/** The tile is den interior. */
export function isDen(board: BoardView, tx: number, ty: number): boolean {
  return tileAt(board, tx, ty) === DEN;
}

/** The tile is the den gate. */
export function isGate(board: BoardView, tx: number, ty: number): boolean {
  return tileAt(board, tx, ty) === GATE;
}

/**
 * The tile is open to a PREDATOR: corridor, den interior or the den gate.
 *
 * specs/movement.md opens the gate and the chamber to the predators alone, so
 * this is the graph a released predator travels and the one "a reachable den" is
 * decided on.
 */
export function isPredatorOpen(
  board: BoardView,
  tx: number,
  ty: number,
): boolean {
  const at = tileAt(board, tx, ty);
  return at === CORRIDOR || at === DEN || at === GATE;
}

/** The logical center of tile `(tx, ty)`, from the board's own grid frame. */
export function tileCenter(
  grid: GridFrame,
  tx: number,
  ty: number,
): { x: number; y: number } {
  return {
    x: grid.originX + tx * grid.tile + grid.tile / 2,
    y: grid.originY + ty * grid.tile + grid.tile / 2,
  };
}

/** The distance between two tile centers, in logical units. */
export function tileGap(grid: GridFrame, a: Tile, b: Tile): number {
  const from = tileCenter(grid, a.tx, a.ty);
  const to = tileCenter(grid, b.tx, b.ty);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/* -------------------------------------------------------------------------- */
/* The wrap tunnel and neighbors                                              */
/* -------------------------------------------------------------------------- */

/**
 * EVERY row whose column `0` and column `cols - 1` tiles are both corridor.
 *
 * specs/maze.md pierces exactly one, so a structural read wants the whole list:
 * none means the build drew no tunnel, and more than one means it drew a border
 * it did not seal.
 */
export function wrapRows(board: BoardView): number[] {
  const found: number[] = [];
  for (let r = 0; r < board.grid.rows; r += 1) {
    if (isCorridor(board, 0, r) && isCorridor(board, board.grid.cols - 1, r)) {
      found.push(r);
    }
  }
  return found;
}

/** The one pierced row, or `-1` where the board does not carry exactly one. */
export function wrapRow(board: BoardView): number {
  const rows = wrapRows(board);
  return rows.length === 1 ? rows[0] : -1;
}

/** True when any tile on row `r` is den interior or the den gate. */
export function rowTouchesDen(board: BoardView, r: number): boolean {
  const line = board.tiles[r] ?? "";
  return line.includes(DEN) || line.includes(GATE);
}

/**
 * One tile step in `dir` from `(tx, ty)`, applying the wrap tunnel.
 *
 * The two mouths of the pierced row are neighbors of each other
 * (specs/maze.md), so a step off either border column on that row arrives on the
 * other. Every other step is the plain orthogonal one, and a step off the board
 * lands on coordinates `tileAt` reads as rock.
 */
export function stepTile(
  board: BoardView,
  tx: number,
  ty: number,
  dir: Dir,
): Tile {
  const [dc, dr] = STEP[dir];
  let nx = tx + dc;
  const ny = ty + dr;
  if (ty === wrapRow(board)) {
    if (nx < 0) nx = board.grid.cols - 1;
    else if (nx >= board.grid.cols) nx = 0;
  }
  return { tx: nx, ty: ny };
}

/** The directions from `(tx, ty)` whose neighbor is corridor. */
export function corridorDirs(board: BoardView, tx: number, ty: number): Dir[] {
  return DIRS.filter((dir) => {
    const next = stepTile(board, tx, ty, dir);
    return isCorridor(board, next.tx, next.ty);
  });
}

/** The directions from `(tx, ty)` whose neighbor is rock. */
export function rockDirs(board: BoardView, tx: number, ty: number): Dir[] {
  return DIRS.filter((dir) => {
    const next = stepTile(board, tx, ty, dir);
    return isRock(board, next.tx, next.ty);
  });
}

/* -------------------------------------------------------------------------- */
/* Whole-board reads                                                          */
/* -------------------------------------------------------------------------- */

/** Every corridor tile on the board, in reading order. */
export function corridorTiles(board: BoardView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < board.grid.rows; ty += 1) {
    for (let tx = 0; tx < board.grid.cols; tx += 1) {
      if (isCorridor(board, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** Every den-interior tile, in reading order. */
export function denTiles(board: BoardView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < board.grid.rows; ty += 1) {
    for (let tx = 0; tx < board.grid.cols; tx += 1) {
      if (isDen(board, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** Every den-gate tile, in reading order. */
export function gateTiles(board: BoardView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < board.grid.rows; ty += 1) {
    for (let tx = 0; tx < board.grid.cols; tx += 1) {
      if (isGate(board, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** A tile as the `"tx,ty"` key every set below is keyed on. */
export function tileKey(tile: Tile): string {
  return `${tile.tx},${tile.ty}`;
}

/**
 * The den-interior tiles that touch a corridor neighbor.
 *
 * specs/maze.md encloses the chamber: no den-interior tile has a corridor
 * neighbor, so the gate is its only opening. Each entry names the breach.
 */
export function denCorridorBreaches(board: BoardView): {
  tile: Tile;
  dir: Dir;
  neighbor: Tile;
}[] {
  const out: { tile: Tile; dir: Dir; neighbor: Tile }[] = [];
  for (const tile of denTiles(board)) {
    for (const dir of DIRS) {
      const neighbor = stepTile(board, tile.tx, tile.ty, dir);
      if (isCorridor(board, neighbor.tx, neighbor.ty)) {
        out.push({ tile, dir, neighbor });
      }
    }
  }
  return out;
}

/** Every corridor tile that neighbors a den gate, with the way in. */
export function gateApproaches(board: BoardView): {
  tile: Tile;
  gate: Tile;
  /** The heading that carries a body from `tile` onto `gate`. */
  dir: Dir;
}[] {
  const out: { tile: Tile; gate: Tile; dir: Dir }[] = [];
  for (const gate of gateTiles(board)) {
    for (const dir of DIRS) {
      const tile = stepTile(board, gate.tx, gate.ty, dir);
      if (isCorridor(board, tile.tx, tile.ty)) {
        out.push({ tile, gate, dir: OPPOSITE[dir] });
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The rules specs/maze.md states of a conforming maze                        */
/* -------------------------------------------------------------------------- */

/**
 * The number of `2 x 2` blocks whose four cells are all corridor.
 *
 * "No four corridor tiles form a `2 x 2` block anywhere on the grid", so a
 * conforming maze answers `0` and its corridors run one tile wide throughout.
 * The den chamber is made of den-interior tiles rather than corridor, so it is
 * not counted here.
 */
export function count2x2Open(board: BoardView): number {
  let blocks = 0;
  for (let ty = 0; ty < board.grid.rows - 1; ty += 1) {
    for (let tx = 0; tx < board.grid.cols - 1; tx += 1) {
      if (
        isCorridor(board, tx, ty) &&
        isCorridor(board, tx + 1, ty) &&
        isCorridor(board, tx, ty + 1) &&
        isCorridor(board, tx + 1, ty + 1)
      ) {
        blocks += 1;
      }
    }
  }
  return blocks;
}

/**
 * The cells where column `c` and column `cols - 1 - c` disagree about rock.
 *
 * "Rock mirrors rock, and a tile that is not rock mirrors a tile that is not
 * rock." A pair is exempt when either of its two tiles is den interior or the
 * den gate, so a chamber with one gate on the centerline costs nothing here.
 * Each cell of a disagreeing pair is counted, so a conforming maze answers `0`.
 */
export function symmetryMismatches(board: BoardView): number {
  const exempt = (tx: number, ty: number): boolean =>
    isDen(board, tx, ty) || isGate(board, tx, ty);
  let mismatches = 0;
  for (let ty = 0; ty < board.grid.rows; ty += 1) {
    for (let tx = 0; tx < board.grid.cols; tx += 1) {
      const mirror = board.grid.cols - 1 - tx;
      if (exempt(tx, ty) || exempt(mirror, ty)) continue;
      if (isRock(board, tx, ty) !== isRock(board, mirror, ty)) mismatches += 1;
    }
  }
  return mismatches;
}

/**
 * The corridor tiles reachable from `(tx, ty)` over corridor neighbors, keyed by
 * {@link tileKey}. Wrap-aware, because the tunnel's two mouths are neighbors.
 *
 * "Every corridor tile is reachable from every other corridor tile", so a
 * conforming maze answers a set the size of {@link corridorTiles}.
 */
export function floodReachable(
  board: BoardView,
  tx: number,
  ty: number,
): Set<string> {
  const seen = new Set<string>();
  if (!isCorridor(board, tx, ty)) return seen;
  const stack: Tile[] = [{ tx, ty }];
  seen.add(tileKey({ tx, ty }));
  while (stack.length > 0) {
    const at = stack.pop() as Tile;
    for (const dir of DIRS) {
      const next = stepTile(board, at.tx, at.ty, dir);
      const key = tileKey(next);
      if (isCorridor(board, next.tx, next.ty) && !seen.has(key)) {
        seen.add(key);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * The tiles a PREDATOR can reach from any of `sources`, over corridor, den and
 * gate tiles alike, keyed by {@link tileKey}.
 *
 * Seeded from the chamber, this is the set a released predator can get to, which
 * is what "a reachable den" is decided on: the forager's start tile lies in it.
 */
export function predatorReachable(
  board: BoardView,
  sources: readonly Tile[],
): Set<string> {
  const seen = new Set<string>();
  const stack: Tile[] = [];
  for (const source of sources) {
    const key = tileKey(source);
    if (isPredatorOpen(board, source.tx, source.ty) && !seen.has(key)) {
      seen.add(key);
      stack.push(source);
    }
  }
  while (stack.length > 0) {
    const at = stack.pop() as Tile;
    for (const dir of DIRS) {
      const next = stepTile(board, at.tx, at.ty, dir);
      const key = tileKey(next);
      if (isPredatorOpen(board, next.tx, next.ty) && !seen.has(key)) {
        seen.add(key);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * The corridor tiles with fewer than two corridor neighbors.
 *
 * "Every corridor tile has at least two corridor neighbors", so a conforming
 * maze answers an empty list.
 */
export function deadEnds(board: BoardView): Tile[] {
  return corridorTiles(board).filter(
    (tile) => corridorDirs(board, tile.tx, tile.ty).length < 2,
  );
}

/** The corridor tiles with three or more corridor neighbors. */
export function junctions(board: BoardView): Tile[] {
  return corridorTiles(board).filter(
    (tile) => corridorDirs(board, tile.tx, tile.ty).length >= 3,
  );
}

/**
 * Corridor distance from `from` to every corridor tile within `maxSteps`, by a
 * breadth-first walk over corridor neighbors, keyed by {@link tileKey}.
 *
 * This is the graph the sonar pulse floods along and the one a chase closes
 * along, both of which travel corridors rather than straight lines. `from`
 * itself is at `0`.
 */
export function corridorDistances(
  board: BoardView,
  from: Tile,
  maxSteps = Number.POSITIVE_INFINITY,
): Map<string, number> {
  const distance = new Map<string, number>();
  if (!isCorridor(board, from.tx, from.ty)) return distance;
  distance.set(tileKey(from), 0);
  let frontier: Tile[] = [from];
  let step = 0;
  while (frontier.length > 0 && step < maxSteps) {
    step += 1;
    const next: Tile[] = [];
    for (const at of frontier) {
      for (const dir of DIRS) {
        const neighbor = stepTile(board, at.tx, at.ty, dir);
        const key = tileKey(neighbor);
        if (isCorridor(board, neighbor.tx, neighbor.ty) && !distance.has(key)) {
          distance.set(key, step);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return distance;
}

/* -------------------------------------------------------------------------- */
/* The three proportions                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Openness: the mean number of corridor neighbors per corridor tile.
 *
 * "The total corridor-neighbor count over every corridor tile, divided by the
 * number of corridor tiles." A board with no corridor at all answers `0`.
 */
export function openness(board: BoardView): number {
  const tiles = corridorTiles(board);
  if (tiles.length === 0) return 0;
  let neighbors = 0;
  for (const tile of tiles) {
    neighbors += corridorDirs(board, tile.tx, tile.ty).length;
  }
  return neighbors / tiles.length;
}

/**
 * The mean corridor-run length, in tiles.
 *
 * "A corridor run is a maximal group of corridor tiles that each have exactly
 * two corridor neighbors and that are connected to one another as neighbors",
 * and this is the mean length over every run on the board. A board with no
 * two-neighbor tile at all answers `0`, which reads as maximally grid-like.
 */
export function meanCorridorRun(board: BoardView): number {
  const tiles = corridorTiles(board);
  const straight = new Set(
    tiles
      .filter((tile) => corridorDirs(board, tile.tx, tile.ty).length === 2)
      .map(tileKey),
  );
  const seen = new Set<string>();
  const runs: number[] = [];
  for (const tile of tiles) {
    const key = tileKey(tile);
    if (!straight.has(key) || seen.has(key)) continue;
    let size = 0;
    const stack: Tile[] = [tile];
    seen.add(key);
    while (stack.length > 0) {
      const at = stack.pop() as Tile;
      size += 1;
      for (const dir of DIRS) {
        const next = stepTile(board, at.tx, at.ty, dir);
        const nextKey = tileKey(next);
        if (straight.has(nextKey) && !seen.has(nextKey)) {
          seen.add(nextKey);
          stack.push(next);
        }
      }
    }
    runs.push(size);
  }
  if (runs.length === 0) return 0;
  return runs.reduce((sum, size) => sum + size, 0) / runs.length;
}

/**
 * Density: the corridor tiles over the cells inside the border,
 * `(cols - 2) * (rows - 2)`, which is `544` on the grid specs/overview.md fixes.
 */
export function density(board: BoardView): number {
  const interior = (board.grid.rows - 2) * (board.grid.cols - 2);
  if (interior <= 0) return 0;
  return corridorTiles(board).length / interior;
}

/** One proportion measured against the bounds specs/maze.md states for it. */
export interface Proportion {
  name: "openness" | "corridor run" | "density";
  value: number;
  min: number;
  max: number;
  /** The value lies inside its bounds, both ends in. */
  ok: boolean;
}

/** All three proportions, each measured against its own inclusive bounds. */
export function proportions(board: BoardView): Proportion[] {
  const measured: Omit<Proportion, "ok">[] = [
    {
      name: "openness",
      value: openness(board),
      min: MAZE_OPENNESS_MIN,
      max: MAZE_OPENNESS_MAX,
    },
    {
      name: "corridor run",
      value: meanCorridorRun(board),
      min: MAZE_MAZING_MIN,
      max: MAZE_MAZING_MAX,
    },
    {
      name: "density",
      value: density(board),
      min: MAZE_DENSITY_MIN,
      max: MAZE_DENSITY_MAX,
    },
  ];
  return measured.map((one) => ({
    ...one,
    ok: one.value >= one.min && one.value <= one.max,
  }));
}
