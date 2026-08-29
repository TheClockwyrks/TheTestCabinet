// Fathom — the maze oracle. CASE-PROVIDED.
//
// WHAT IS SHARED. This file is byte-identical in `validation/none/`,
// `validation/simple-2d/` and `validation/structured-2d/`. Every line of it is
// shared, because every line of it is pure: it reads a board — the `grid` frame
// and the `tiles` layout a snapshot reports — and returns a number, a list or a
// set. Nothing here reaches the harness, the engine or the build.
//
// WHAT IS NOT SHARED, AND WHY. `fixtures.ts` and `scene.ts` drive the game, and
// the engineless project reaches it through a browser page while the two engine
// projects reach it in process, so those two carry a harness-touching shell that
// differs. Anything in them that turned out to be a pure function of a board was
// moved HERE instead, which is why {@link tileCenter}, {@link walledDir},
// {@link visibilityAt}, {@link housedTiles} and {@link denIsSealed} live beside
// the structural measures rather than beside the posers that call them.
//
// WHY THE INVARIANT MATTERS. Every measure below is `specs/maze.md` written as
// arithmetic, and that page is one page. Three copies of it would drift, and a
// change to the specification would have to be made three times and would not be
// made the same way three times. One file makes the arithmetic one thing, so the
// three engines' suites cannot disagree about what the specification says.
//
// WHY THESE READ THE BUILD'S OWN BOARD. Nearly every other scenario in this
// suite poses the geometry it is about through `setMaze` (see `fixtures.ts`),
// because what a build's own maze happens to offer is not something a check
// should turn on. The eight `maze/*` points are the exception: FINDING these
// properties in the board the build laid out for itself IS the check, and a
// posed fixture is explicitly exempt from every rule here
// (`specs/instrumentation.md`). So these functions take a board and never pose
// one.
//
// WHAT A NEIGHBOR IS. `specs/maze.md`: two tiles are neighbors when they are
// orthogonally adjacent, and the wrap tunnel adds one further pair, the two
// mouths of its pierced row. Every traversal below steps through
// {@link stepTile}, so the tunnel is part of the graph exactly once and nothing
// has to remember to special-case it.
//
// WHAT A CORRIDOR TILE IS. The `.` tiles alone. The den interior and the den
// gate are excluded from both the tiles measured and the neighbors counted, as
// the proportions section of that page states, which is why {@link isCorridor}
// tests for `.` and {@link isPredatorOpen} — the wider graph a predator travels
// — is a separate reading, used only where a predator's reach is the question.
//
// THE BOUNDS ARE NOT HERE. A check states the bound it asserts, from the
// `MAZE_*` figures its own project can reach, so a reader of the check sees the
// whole of what it required.

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

/** The tile alphabet `snapshot().tiles` and `setMaze` both use. */
export const ROCK = "#";
export const CORRIDOR = ".";
export const GATE = "g";
export const DEN = "d";

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
  /** One tile's size, on both axes, in logical units. */
  tile: number;
  /** Column `0`'s left edge, in logical units. */
  originX: number;
  /** Row `0`'s top edge, in logical units. */
  originY: number;
}

/**
 * The whole of a board a structural measure reads: the frame and the layout.
 *
 * Structural rather than imported, so an engine's own full snapshot type is one
 * of these without conversion, and so is a layout a fixture built before it was
 * ever posed.
 */
export interface MazeView {
  grid: GridFrame;
  tiles: readonly string[];
}

/** One tile, by column and row. */
export interface Tile {
  tx: number;
  ty: number;
}

/** A point in logical units. */
export interface Point {
  x: number;
  y: number;
}

/* -------------------------------------------------------------------------- */
/* Reading one tile                                                           */
/* -------------------------------------------------------------------------- */

/** The character at `(tx, ty)`, or `undefined` off the board. */
export function tileAt(
  view: MazeView,
  tx: number,
  ty: number,
): string | undefined {
  return view.tiles[ty]?.[tx];
}

/** The tile is open corridor: the only kind the forager travels. */
export function isCorridor(view: MazeView, tx: number, ty: number): boolean {
  return tileAt(view, tx, ty) === CORRIDOR;
}

/** The tile is rock, or off the board, which is solid to every body alike. */
export function isRock(view: MazeView, tx: number, ty: number): boolean {
  const at = tileAt(view, tx, ty);
  return at === undefined || at === ROCK;
}

/** The tile is den interior. */
export function isDen(view: MazeView, tx: number, ty: number): boolean {
  return tileAt(view, tx, ty) === DEN;
}

/** The tile is the den gate. */
export function isGate(view: MazeView, tx: number, ty: number): boolean {
  return tileAt(view, tx, ty) === GATE;
}

/**
 * The tile is den interior or the den gate: the chamber and its door together.
 *
 * The reading `specs/maze.md`'s symmetry rule exempts a mirrored pair for, and
 * the reading that decides where `setMaze` is entitled to have left a predator.
 */
export function isDenOrGate(view: MazeView, tx: number, ty: number): boolean {
  const at = tileAt(view, tx, ty);
  return at === DEN || at === GATE;
}

/**
 * The tile is open to a PREDATOR: corridor, den interior or the den gate.
 *
 * `specs/movement.md` opens the gate and the chamber to the predators alone, so
 * this is the graph a released predator travels and the one "a reachable den" is
 * decided on. The forager's own graph is {@link isCorridor}.
 */
export function isPredatorOpen(
  view: MazeView,
  tx: number,
  ty: number,
): boolean {
  const at = tileAt(view, tx, ty);
  return at === CORRIDOR || at === DEN || at === GATE;
}

/** The logical center of a tile, from the board's own grid frame. */
export function tileCenter(grid: GridFrame, tile: Tile): Point {
  return {
    x: grid.originX + tile.tx * grid.tile + grid.tile / 2,
    y: grid.originY + tile.ty * grid.tile + grid.tile / 2,
  };
}

/** The straight-line distance between two tile centers, in logical units. */
export function tileGap(grid: GridFrame, a: Tile, b: Tile): number {
  const from = tileCenter(grid, a);
  const to = tileCenter(grid, b);
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * A board's fog band, as `snapshot().visibility` reports it.
 *
 * Declared apart from {@link MazeView} because the layout and the fog are read
 * by different measures: the structural rules never look at the fog, and the
 * points that do never look at the layout.
 */
export interface VisibilityView {
  visibility: readonly string[];
}

/**
 * The visibility character reported for a tile: `u`, `r` or `l`
 * (`specs/state.md`), or `undefined` where the band does not cover it.
 */
export function visibilityAt(
  view: VisibilityView,
  tile: Tile,
): string | undefined {
  return view.visibility[tile.ty]?.[tile.tx];
}

/** A tile as the `"tx,ty"` key every set and map below is keyed on. */
export function tileKey(tile: Tile): string {
  return `${tile.tx},${tile.ty}`;
}

/* -------------------------------------------------------------------------- */
/* The wrap tunnel and neighbors                                              */
/* -------------------------------------------------------------------------- */

/**
 * EVERY row whose column `0` and column `cols - 1` tiles are both corridor.
 *
 * `specs/maze.md` pierces exactly one, so a structural read wants the whole
 * list: none means the build drew no tunnel, and more than one means it drew a
 * border it did not seal.
 */
export function wrapRows(view: MazeView): number[] {
  const found: number[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    if (isCorridor(view, 0, ty) && isCorridor(view, view.grid.cols - 1, ty)) {
      found.push(ty);
    }
  }
  return found;
}

/** The one pierced row, or `-1` where the board does not carry exactly one. */
export function wrapRow(view: MazeView): number {
  const rows = wrapRows(view);
  return rows.length === 1 ? rows[0] : -1;
}

/**
 * One tile step in `dir` from `(tx, ty)`, applying the wrap tunnel.
 *
 * The two mouths of the pierced row are neighbors of each other
 * (`specs/maze.md`), so a step off either border column on that row arrives on
 * the other. Every other step is the plain orthogonal one, and a step off the
 * board lands on coordinates {@link tileAt} reads as rock.
 */
export function stepTile(
  view: MazeView,
  tx: number,
  ty: number,
  dir: Dir,
): Tile {
  const [dc, dr] = STEP[dir];
  let nx = tx + dc;
  const ny = ty + dr;
  if (ty === wrapRow(view)) {
    if (nx < 0) nx = view.grid.cols - 1;
    else if (nx >= view.grid.cols) nx = 0;
  }
  return { tx: nx, ty: ny };
}

/** The directions from `(tx, ty)` whose neighbor is corridor. */
export function corridorDirs(view: MazeView, tx: number, ty: number): Dir[] {
  return DIRS.filter((dir) => {
    const next = stepTile(view, tx, ty, dir);
    return isCorridor(view, next.tx, next.ty);
  });
}

/**
 * A direction from `tile` with no corridor beyond it, or `null` at a crossroads.
 *
 * What a bystander scenario faces the forager into. `specs/movement.md` has a
 * forager at rest take its desired direction when the tile that way is open to
 * it and stay at rest otherwise, so a heading that leads nowhere cannot take it
 * off its tile under any conforming reading.
 */
export function walledDir(view: MazeView, tile: Tile): Dir | null {
  const open = corridorDirs(view, tile.tx, tile.ty);
  return DIRS.find((dir) => !open.includes(dir)) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Whole-board reads                                                          */
/* -------------------------------------------------------------------------- */

/** Every corridor tile on the board, in reading order. */
export function corridorTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (isCorridor(view, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** Every den-interior tile, in reading order. */
export function denTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (isDen(view, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/** Every den-gate tile, in reading order. `specs/maze.md` fixes exactly one. */
export function gateTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (isGate(view, tx, ty)) out.push({ tx, ty });
    }
  }
  return out;
}

/**
 * The den and gate tiles of a board, keyed by {@link tileKey}: where a predator
 * belongs.
 *
 * `specs/instrumentation.md` returns every predator to a den tile, so on a board
 * that carries a chamber this set is the whole of where one is entitled to be
 * standing when a fixture has just been posed.
 */
export function housedTiles(view: MazeView): Set<string> {
  const housed = new Set<string>();
  for (const tile of [...denTiles(view), ...gateTiles(view)]) {
    housed.add(tileKey(tile));
  }
  return housed;
}

/* -------------------------------------------------------------------------- */
/* The rules specs/maze.md states of a conforming maze                        */
/* -------------------------------------------------------------------------- */

/**
 * The number of `2 x 2` blocks whose four cells are all corridor.
 *
 * "No four corridor tiles form a `2 x 2` block anywhere on the grid", so a
 * conforming maze answers `0` and its corridors run one tile wide throughout.
 * The den chamber is made of den-interior tiles rather than corridor, so the one
 * open area wider than a corridor is exempt by construction.
 */
export function count2x2Open(view: MazeView): number {
  let blocks = 0;
  for (let ty = 0; ty < view.grid.rows - 1; ty += 1) {
    for (let tx = 0; tx < view.grid.cols - 1; tx += 1) {
      if (
        isCorridor(view, tx, ty) &&
        isCorridor(view, tx + 1, ty) &&
        isCorridor(view, tx, ty + 1) &&
        isCorridor(view, tx + 1, ty + 1)
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
 * Each cell of a disagreeing pair is counted, so a board of `n` mismatched pairs
 * reads `2n`; a conforming maze answers `0`, which is the only figure a check
 * asserts on it.
 */
export function symmetryMismatches(view: MazeView): number {
  let mismatches = 0;
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      const mirror = view.grid.cols - 1 - tx;
      if (isDenOrGate(view, tx, ty) || isDenOrGate(view, mirror, ty)) continue;
      if (isRock(view, tx, ty) !== isRock(view, mirror, ty)) mismatches += 1;
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
  view: MazeView,
  tx: number,
  ty: number,
): Set<string> {
  const seen = new Set<string>();
  if (!isCorridor(view, tx, ty)) return seen;
  const stack: Tile[] = [{ tx, ty }];
  seen.add(tileKey({ tx, ty }));
  while (stack.length > 0) {
    const at = stack.pop() as Tile;
    for (const dir of DIRS) {
      const next = stepTile(view, at.tx, at.ty, dir);
      const key = tileKey(next);
      if (isCorridor(view, next.tx, next.ty) && !seen.has(key)) {
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
  view: MazeView,
  sources: readonly Tile[],
): Set<string> {
  const seen = new Set<string>();
  const stack: Tile[] = [];
  for (const source of sources) {
    const key = tileKey(source);
    if (isPredatorOpen(view, source.tx, source.ty) && !seen.has(key)) {
      seen.add(key);
      stack.push(source);
    }
  }
  while (stack.length > 0) {
    const at = stack.pop() as Tile;
    for (const dir of DIRS) {
      const next = stepTile(view, at.tx, at.ty, dir);
      const key = tileKey(next);
      if (isPredatorOpen(view, next.tx, next.ty) && !seen.has(key)) {
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
 * "Every corridor tile has at least two corridor neighbors, so the forager
 * passes through a tile and comes back around another way." A conforming maze
 * answers an empty list.
 */
export function deadEnds(view: MazeView): Tile[] {
  return corridorTiles(view).filter(
    (tile) => corridorDirs(view, tile.tx, tile.ty).length < 2,
  );
}

/**
 * The den-interior tiles that touch a corridor neighbor, in reading order.
 *
 * "No den-interior tile has a corridor neighbor, so the gate is the chamber's
 * only opening onto the corridors." A conforming maze answers an empty list. One
 * entry per breached TILE, however many of its sides touch corridor, because the
 * reading `specs/maze.md` bounds is how many den-interior tiles are breached.
 */
export function denCorridorBreaches(view: MazeView): Tile[] {
  return denTiles(view).filter((tile) =>
    DIRS.some((dir) => {
      const next = stepTile(view, tile.tx, tile.ty, dir);
      return isCorridor(view, next.tx, next.ty);
    }),
  );
}

/**
 * Nothing a predator may stand on leads out of this board's den chamber.
 *
 * `false` for a board with no chamber at all, which fixes nothing about where a
 * predator belongs. Every fixture `fixtures.ts` stamps carries a sealed one, so
 * a scenario that finds a hunter it denned standing loose on such a board knows
 * the departure was not geometry's doing.
 */
export function denIsSealed(view: MazeView): boolean {
  const chamber = denTiles(view);
  if (chamber.length === 0) return false;
  const inside = housedTiles(view);
  for (const key of predatorReachable(view, chamber)) {
    if (!inside.has(key)) return false;
  }
  return true;
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
export function openness(view: MazeView): number {
  const tiles = corridorTiles(view);
  if (tiles.length === 0) return 0;
  let neighbors = 0;
  for (const tile of tiles) {
    neighbors += corridorDirs(view, tile.tx, tile.ty).length;
  }
  return neighbors / tiles.length;
}

/**
 * The mean corridor-run length, in tiles.
 *
 * "A corridor run is a maximal group of corridor tiles that each have exactly
 * two corridor neighbors and that are connected to one another as neighbors",
 * and this is the mean length over every run on the board. A board with no
 * two-neighbor tile at all has no runs and answers `0`, which reads as maximally
 * grid-like and falls below the lower bound, as it should.
 */
export function meanCorridorRun(view: MazeView): number {
  const tiles = corridorTiles(view);
  const straight = new Set(
    tiles
      .filter((tile) => corridorDirs(view, tile.tx, tile.ty).length === 2)
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
        const next = stepTile(view, at.tx, at.ty, dir);
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
 * `(cols - 2) * (rows - 2)`, which is `544` on the grid `specs/overview.md`
 * fixes.
 *
 * Measured against the build's OWN reported frame rather than against that fixed
 * figure, so a board of the wrong size fails the point that owns that claim
 * rather than turning up here as a density a reviewer cannot interpret.
 */
export function density(view: MazeView): number {
  const interior = (view.grid.rows - 2) * (view.grid.cols - 2);
  if (interior <= 0) return 0;
  return corridorTiles(view).length / interior;
}
