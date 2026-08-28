// Fathom — the maze oracle. CASE-PROVIDED, and shared byte-identically by every
// engine's validator project.
//
// WHAT THIS IS FOR. `specs/maze.md` states the rules every maze the game lays out
// for itself satisfies, and eight review items decide whether a build's own board
// satisfies them. Those eight are the exception to "pose the geometry you are
// about": finding these properties in the board the BUILD invented is the whole
// check, so they read `snapshot().tiles` rather than a posed fixture.
//
// Every measure below is written from `specs/maze.md` alone. Nothing here knows
// what the reference implementation's generator produces, and nothing here is
// tuned to it: the three proportion bounds are the ones that page states, in the
// units that page states them in, and the four structural counts are the literal
// readings of the four rules it lists.
//
// IT IMPORTS NOTHING. The measures are pure functions of a board, so this module
// is the same file under every engine and can be reasoned about — and unit-tested
// — without a browser, an engine, or a build.

/** One tile, in the alphabet `specs/state.md` fixes for the layout. */
export type Tile = "#" | "." | "g" | "d";

/** The tile grid's frame, as a snapshot reports it (`specs/state.md`). */
export interface GridFrame {
  cols: number;
  rows: number;
  tile: number;
  originX: number;
  originY: number;
}

/**
 * The part of a snapshot a structural measure reads: the frame and the layout.
 *
 * Declared structurally rather than imported so this module stays byte-identical
 * across the engine projects. Every engine's full snapshot type satisfies it.
 */
export interface MazeView {
  grid: GridFrame;
  tiles: readonly string[];
}

/** A tile address on the grid. */
export interface TileRef {
  tx: number;
  ty: number;
}

/** The four cardinal directions, as `specs/state.md` names them. */
export type Dir = "up" | "down" | "left" | "right";

/** The unit step each direction takes, in grid columns and rows. */
export const DIRS: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Every direction, in a fixed order, for a sweep that wants all four. */
export const ALL_DIRS: readonly Dir[] = ["up", "down", "left", "right"];

/** The direction that undoes `dir`. */
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

/** The character at `(tx, ty)`, or `undefined` off the board. */
export function tileAt(
  view: MazeView,
  tx: number,
  ty: number,
): string | undefined {
  return view.tiles[ty]?.[tx];
}

/** The tile is open CORRIDOR: what the forager travels and what a measure counts. */
export function isCorridor(view: MazeView, tx: number, ty: number): boolean {
  return tileAt(view, tx, ty) === ".";
}

/** The tile is rock, or off the board, which is solid to everything. */
export function isRock(view: MazeView, tx: number, ty: number): boolean {
  const tile = tileAt(view, tx, ty);
  return tile === undefined || tile === "#";
}

/** The tile is den interior or the den gate: the predators' own ground. */
export function isDen(view: MazeView, tx: number, ty: number): boolean {
  const tile = tileAt(view, tx, ty);
  return tile === "d" || tile === "g";
}

/**
 * The tile is open to a PREDATOR: corridor, den interior, or the den gate.
 *
 * `specs/movement.md` gives the predators the gate and the chamber and gives the
 * forager neither, so a trace of where a released predator can get to runs over
 * this adjacency and a trace of where the forager can get to runs over
 * {@link isCorridor}.
 */
export function isPredatorOpen(
  view: MazeView,
  tx: number,
  ty: number,
): boolean {
  const tile = tileAt(view, tx, ty);
  return tile === "." || tile === "d" || tile === "g";
}

/**
 * Every row whose column `0` and column `cols - 1` tiles are both corridor: the
 * rows that pierce the border.
 *
 * `specs/maze.md` allows EXACTLY ONE, so a structural read wants the whole list
 * rather than the first: none means the build drew no wrap tunnel, and more than
 * one means it drew a border it did not seal.
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

/** The one pierced row, or `-1` where the board does not have exactly one. */
export function wrapRow(view: MazeView): number {
  const rows = wrapRows(view);
  return rows.length === 1 ? rows[0] : -1;
}

/**
 * One step from `(tx, ty)` in `dir`, with the wrap tunnel applied.
 *
 * The two mouths of the pierced row are neighbors of each other
 * (`specs/maze.md`), so a step off one border column of that row arrives on the
 * other. Off any other row it simply leaves the board, and the caller's own
 * openness test rejects it.
 */
export function step(
  view: MazeView,
  tx: number,
  ty: number,
  dir: Dir,
): TileRef {
  const [dx, dy] = DIRS[dir];
  let nx = tx + dx;
  const ny = ty + dy;
  if (ty === wrapRow(view)) {
    if (nx < 0) nx = view.grid.cols - 1;
    else if (nx >= view.grid.cols) nx = 0;
  }
  return { tx: nx, ty: ny };
}

/** The directions from `(tx, ty)` that have a corridor neighbor. */
export function corridorNeighborDirs(
  view: MazeView,
  tx: number,
  ty: number,
): Dir[] {
  return ALL_DIRS.filter((dir) => {
    const next = step(view, tx, ty, dir);
    return isCorridor(view, next.tx, next.ty);
  });
}

/** Every corridor tile on the board, in reading order. */
export function corridorTiles(view: MazeView): TileRef[] {
  const found: TileRef[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (isCorridor(view, tx, ty)) found.push({ tx, ty });
    }
  }
  return found;
}

/** Every den-interior tile on the board, in reading order. */
export function denTiles(view: MazeView): TileRef[] {
  const found: TileRef[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (tileAt(view, tx, ty) === "d") found.push({ tx, ty });
    }
  }
  return found;
}

/** Every den-gate tile on the board, in reading order. `specs/maze.md` allows one. */
export function gateTiles(view: MazeView): TileRef[] {
  const found: TileRef[] = [];
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      if (tileAt(view, tx, ty) === "g") found.push({ tx, ty });
    }
  }
  return found;
}

/** A tile address as the key a reachability set holds it under. */
export function key(tile: TileRef): string {
  return `${tile.tx},${tile.ty}`;
}

// ---- The four structural rules -------------------------------------------

/**
 * How many `2 x 2` blocks of the grid are four corridor tiles.
 *
 * `specs/maze.md`: "No four corridor tiles form a `2 x 2` block anywhere on the
 * grid". The den chamber is made of den-interior tiles rather than corridor, so
 * it is not one of these by construction.
 */
export function count2x2Open(view: MazeView): number {
  let found = 0;
  for (let ty = 0; ty < view.grid.rows - 1; ty += 1) {
    for (let tx = 0; tx < view.grid.cols - 1; tx += 1) {
      if (
        isCorridor(view, tx, ty) &&
        isCorridor(view, tx + 1, ty) &&
        isCorridor(view, tx, ty + 1) &&
        isCorridor(view, tx + 1, ty + 1)
      ) {
        found += 1;
      }
    }
  }
  return found;
}

/**
 * How many cells disagree with their mirror about being rock.
 *
 * `specs/maze.md`: column `c` and column `cols - 1 - c` carry the same kind of
 * tile in every row, rock mirroring rock and not-rock mirroring not-rock, with a
 * pair EXEMPT when either of its two tiles is den interior or the den gate. Each
 * cell of a disagreeing pair is counted, so a board of `n` mismatched pairs
 * reads `2n` — the count is a mismatch tally rather than a pair tally, and the
 * only figure a check asserts on it is zero.
 */
export function symmetryMismatches(view: MazeView): number {
  let found = 0;
  for (let ty = 0; ty < view.grid.rows; ty += 1) {
    for (let tx = 0; tx < view.grid.cols; tx += 1) {
      const mirror = view.grid.cols - 1 - tx;
      if (isDen(view, tx, ty) || isDen(view, mirror, ty)) continue;
      if (isRock(view, tx, ty) !== isRock(view, mirror, ty)) found += 1;
    }
  }
  return found;
}

/**
 * Every corridor tile reachable from `(tx, ty)` over corridor neighbors, as a set
 * of {@link key}s. Wrap-aware, because the two mouths are neighbors.
 */
export function floodReachable(
  view: MazeView,
  tx: number,
  ty: number,
): Set<string> {
  const seen = new Set<string>();
  if (!isCorridor(view, tx, ty)) return seen;
  const stack: TileRef[] = [{ tx, ty }];
  seen.add(key({ tx, ty }));
  while (stack.length > 0) {
    const here = stack.pop() as TileRef;
    for (const dir of ALL_DIRS) {
      const next = step(view, here.tx, here.ty, dir);
      if (!isCorridor(view, next.tx, next.ty)) continue;
      if (seen.has(key(next))) continue;
      seen.add(key(next));
      stack.push(next);
    }
  }
  return seen;
}

/**
 * Every tile a PREDATOR can reach from any of `sources`, over corridor, den and
 * gate tiles alike, as a set of {@link key}s.
 *
 * Seeded from the den interior this is where a released predator can actually
 * get to, which is what `specs/maze.md`'s reachable-den rule turns on.
 */
export function predatorReachable(
  view: MazeView,
  sources: readonly TileRef[],
): Set<string> {
  const seen = new Set<string>();
  const stack: TileRef[] = [];
  for (const source of sources) {
    if (!isPredatorOpen(view, source.tx, source.ty)) continue;
    if (seen.has(key(source))) continue;
    seen.add(key(source));
    stack.push(source);
  }
  while (stack.length > 0) {
    const here = stack.pop() as TileRef;
    for (const dir of ALL_DIRS) {
      const next = step(view, here.tx, here.ty, dir);
      if (!isPredatorOpen(view, next.tx, next.ty)) continue;
      if (seen.has(key(next))) continue;
      seen.add(key(next));
      stack.push(next);
    }
  }
  return seen;
}

/**
 * Every corridor tile with fewer than two corridor neighbors: a dead end.
 *
 * `specs/maze.md`: "Every corridor tile has at least two corridor neighbors, so
 * the forager passes through a tile and comes back around another way."
 */
export function deadEnds(view: MazeView): TileRef[] {
  return corridorTiles(view).filter(
    (tile) => corridorNeighborDirs(view, tile.tx, tile.ty).length < 2,
  );
}

/**
 * Every corridor tile of the border that is not a wrap-tunnel mouth.
 *
 * `specs/maze.md`: "Row `0`, row `17`, column `0` and column `35` are rock, apart
 * from the two wrap-tunnel mouths." The mouths a board is entitled to are the
 * ones on the row it pierced, so this leaves out only that row's two border
 * columns, and a board with no single pierced row leaves out nothing.
 */
export function borderBreaches(view: MazeView): TileRef[] {
  const pierced = wrapRow(view);
  const { cols, rows } = view.grid;
  const found: TileRef[] = [];
  const consider = (tx: number, ty: number): void => {
    if (!isCorridor(view, tx, ty) && !isDen(view, tx, ty)) return;
    if (ty === pierced && (tx === 0 || tx === cols - 1)) return;
    found.push({ tx, ty });
  };
  for (let tx = 0; tx < cols; tx += 1) {
    consider(tx, 0);
    consider(tx, rows - 1);
  }
  for (let ty = 1; ty < rows - 1; ty += 1) {
    consider(0, ty);
    consider(cols - 1, ty);
  }
  return found;
}

/**
 * Every den-interior tile that has a corridor neighbor.
 *
 * `specs/maze.md`: the chamber "is enclosed. No den-interior tile has a corridor
 * neighbor, so the gate is the chamber's only opening onto the corridors."
 */
export function denCorridorBreaches(view: MazeView): TileRef[] {
  return denTiles(view).filter((tile) =>
    ALL_DIRS.some((dir) => {
      const next = step(view, tile.tx, tile.ty, dir);
      return isCorridor(view, next.tx, next.ty);
    }),
  );
}

// ---- The three proportions ------------------------------------------------

/**
 * Openness: the mean number of corridor neighbors per corridor tile.
 *
 * `specs/maze.md` computes it "over the corridor tiles alone, with the den
 * interior and the den gate excluded from both the tiles measured and the
 * neighbors counted", which is exactly what {@link corridorNeighborDirs}
 * counts. A board with no corridor at all reads `0`.
 */
export function openness(view: MazeView): number {
  const tiles = corridorTiles(view);
  if (tiles.length === 0) return 0;
  let total = 0;
  for (const tile of tiles) {
    total += corridorNeighborDirs(view, tile.tx, tile.ty).length;
  }
  return total / tiles.length;
}

/**
 * The corridor-run measure: the mean length of a maximal group of connected
 * corridor tiles that each have exactly two corridor neighbors.
 *
 * `specs/maze.md` calls those groups "the straightaways and bends between one
 * junction and the next", and their length "the number of tiles in it". A board
 * with no two-neighbor tile at all — a pure grid, a junction everywhere — has no
 * runs, and reads `0`, which is below the lower bound and so fails as it should.
 */
export function meanCorridorRun(view: MazeView): number {
  const tiles = corridorTiles(view);
  const straight = new Set(
    tiles
      .filter(
        (tile) => corridorNeighborDirs(view, tile.tx, tile.ty).length === 2,
      )
      .map(key),
  );
  const seen = new Set<string>();
  const lengths: number[] = [];
  for (const tile of tiles) {
    if (!straight.has(key(tile)) || seen.has(key(tile))) continue;
    let size = 0;
    const stack: TileRef[] = [tile];
    seen.add(key(tile));
    while (stack.length > 0) {
      const here = stack.pop() as TileRef;
      size += 1;
      for (const dir of ALL_DIRS) {
        const next = step(view, here.tx, here.ty, dir);
        if (!straight.has(key(next)) || seen.has(key(next))) continue;
        seen.add(key(next));
        stack.push(next);
      }
    }
    lengths.push(size);
  }
  if (lengths.length === 0) return 0;
  return lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
}

/**
 * Density: corridor tiles over the cells inside the border,
 * `(cols - 2) * (rows - 2)` (`specs/maze.md`, which is `544` on the fixed grid).
 *
 * Measured against the build's OWN reported frame rather than against the fixed
 * figure, so a board of the wrong size fails the grid point that owns that claim
 * rather than turning up here as a density a reviewer cannot interpret.
 */
export function density(view: MazeView): number {
  const interior = (view.grid.cols - 2) * (view.grid.rows - 2);
  if (interior <= 0) return 0;
  return corridorTiles(view).length / interior;
}

/** The three proportions together, for a check that reports all of them. */
export function proportions(view: MazeView): {
  openness: number;
  corridorRun: number;
  density: number;
} {
  return {
    openness: openness(view),
    corridorRun: meanCorridorRun(view),
    density: density(view),
  };
}
