// Fathom — the maze oracle. CASE-PROVIDED, and byte-identical in every engine
// directory.
//
// specs/maze.md states the rules every maze a build lays out satisfies, and this
// module is those rules written as measurements. It imports nothing — not the
// build, not the engine, not the harness — so what it computes is the
// specification's own arithmetic over a layout, and the same numbers come out
// whichever engine drove the game that produced it.
//
// THESE READ THE BUILD'S OWN BOARD. Almost every other scenario in this suite
// poses the geometry it is about (see `fixtures.ts`), because the layout is the
// build's to design and hunting for a shape in it measures the maze rather than
// the mechanic. The eight `maze/*` items are the exception, and this module is
// what they are made of: the properties they decide are properties OF the
// layout, so finding them there is the check.
//
// WHAT A "NEIGHBOR" IS. specs/maze.md: two tiles are neighbors when they are
// orthogonally adjacent, and the wrap tunnel adds one further pair, the two
// mouths of its pierced row. Every traversal below steps through
// {@link stepTile}, so the tunnel is part of the graph exactly once and nothing
// has to remember to special-case it.
//
// WHAT A "CORRIDOR TILE" IS. The `'.'` tiles alone. The den interior and the den
// gate are excluded from both the tiles measured and the neighbors counted, as
// the proportions section states, which is why {@link isOpen} tests for `'.'`
// and {@link isPredOpen} — the wider graph a predator travels — is a separate
// reading used only where a predator's reach is the question.

/** The tile grid's frame, as a snapshot reports it. */
export interface Grid {
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
 * The least of a snapshot this module reads: the grid's frame and the layout.
 *
 * Structural, so a `FathomSnapshot` from any engine's `surface.ts` is one of
 * these, and so is a layout a fixture built before it was ever posed.
 */
export interface MazeView {
  grid: Grid;
  tiles: readonly string[];
}

/** The four cardinals, as a delta in tiles. */
export const DIRS: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** The four cardinals a body faces and travels along. */
export type Dir = "up" | "down" | "left" | "right";

/** The four cardinals, in a fixed order, for a walk over all of them. */
export const CARDINALS: readonly Dir[] = ["up", "down", "left", "right"];

/** The reverse of each cardinal. */
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

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

/** The character at `(c, r)`, or `undefined` off the board. */
export function tileAt(
  view: MazeView,
  c: number,
  r: number,
): string | undefined {
  return view.tiles[r]?.[c];
}

/** The tile is open CORRIDOR: the `'.'` the forager and the predators travel. */
export function isOpen(view: MazeView, c: number, r: number): boolean {
  return tileAt(view, c, r) === ".";
}

/** The tile is rock, or off the board, which is solid to every body. */
export function isWall(view: MazeView, c: number, r: number): boolean {
  const at = tileAt(view, c, r);
  return at === undefined || at === "#";
}

/**
 * The tile is open to a PREDATOR: corridor, den interior, or the den gate.
 *
 * specs/movement.md opens the gate and the chamber to predators alone, so this
 * is the graph a released predator travels and the forager's is {@link isOpen}.
 */
export function isPredOpen(view: MazeView, c: number, r: number): boolean {
  const at = tileAt(view, c, r);
  return at === "." || at === "d" || at === "g";
}

/** The center of tile `(tx, ty)`, in logical units. */
export function tileCenter(grid: Grid, tx: number, ty: number): Point {
  return {
    x: grid.originX + tx * grid.tile + grid.tile / 2,
    y: grid.originY + ty * grid.tile + grid.tile / 2,
  };
}

/** The tile whose bounds contain the logical point `(x, y)`. */
export function tileOf(grid: Grid, x: number, y: number): Tile {
  return {
    tx: Math.floor((x - grid.originX) / grid.tile),
    ty: Math.floor((y - grid.originY) / grid.tile),
  };
}

/**
 * EVERY row whose column `0` and column `cols - 1` tiles are both open.
 *
 * specs/maze.md pierces exactly one row, so the whole list is what a structural
 * read wants: an empty list is a build that drew no tunnel, and more than one is
 * a border it did not seal.
 */
export function wrapRows(view: MazeView): number[] {
  const found: number[] = [];
  for (let r = 0; r < view.grid.rows; r += 1) {
    if (isOpen(view, 0, r) && isOpen(view, view.grid.cols - 1, r))
      found.push(r);
  }
  return found;
}

/** The one pierced row, or `-1` when the layout does not carry exactly one. */
export function wrapRow(view: MazeView): number {
  const rows = wrapRows(view);
  return rows.length === 1 ? rows[0] : -1;
}

/**
 * One tile step in `dir` from `(c, r)`, with the wrap tunnel applied.
 *
 * The two mouths of the pierced row are neighbors of each other
 * (specs/maze.md), and this is the only place that pairing lives, so every
 * traversal below inherits it.
 */
export function stepTile(
  view: MazeView,
  c: number,
  r: number,
  dir: Dir,
): [number, number] {
  const [dc, dr] = DIRS[dir];
  let nc = c + dc;
  const nr = r + dr;
  if (r === wrapRow(view)) {
    if (nc < 0) nc = view.grid.cols - 1;
    else if (nc >= view.grid.cols) nc = 0;
  }
  return [nc, nr];
}

/** Which cardinals lead from `(c, r)` to a corridor neighbor. */
export function openNeighborDirs(view: MazeView, c: number, r: number): Dir[] {
  return CARDINALS.filter((dir) => {
    const [nc, nr] = stepTile(view, c, r, dir);
    return isOpen(view, nc, nr);
  });
}

/** Every corridor tile on the board, in reading order. */
export function openTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      if (isOpen(view, c, r)) out.push({ tx: c, ty: r });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The structural rules                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many `2 x 2` blocks have all four cells corridor.
 *
 * specs/maze.md: no four corridor tiles form such a block anywhere on the grid,
 * so corridors run one tile wide. A conforming layout answers `0`. The den
 * chamber is made of den-interior tiles, which {@link isOpen} does not count, so
 * the one open area wider than a corridor is exempt by construction.
 */
export function count2x2Open(view: MazeView): number {
  let n = 0;
  for (let r = 0; r < view.grid.rows - 1; r += 1) {
    for (let c = 0; c < view.grid.cols - 1; c += 1) {
      if (
        isOpen(view, c, r) &&
        isOpen(view, c + 1, r) &&
        isOpen(view, c, r + 1) &&
        isOpen(view, c + 1, r + 1)
      ) {
        n += 1;
      }
    }
  }
  return n;
}

/**
 * How many cells disagree with their mirror about being rock.
 *
 * specs/maze.md: column `c` and column `cols - 1 - c` carry the same kind of
 * tile in every row, rock mirroring rock and not-rock mirroring not-rock, and a
 * pair is exempt when either of its two tiles is den interior or the den gate. A
 * conforming layout answers `0`. Every cell is visited, so a mismatched pair is
 * counted twice; the reading a check wants is whether it is zero.
 */
export function symmetryMismatches(view: MazeView): number {
  const denCell = (c: number, r: number): boolean => {
    const at = tileAt(view, c, r);
    return at === "d" || at === "g";
  };
  let n = 0;
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      const m = view.grid.cols - 1 - c;
      if (denCell(c, r) || denCell(m, r)) continue;
      if (isWall(view, c, r) !== isWall(view, m, r)) n += 1;
    }
  }
  return n;
}

/** Every corridor tile reachable from `(sc, sr)` over corridor neighbors. */
export function floodReachable(
  view: MazeView,
  sc: number,
  sr: number,
): Set<string> {
  const seen = new Set<string>();
  if (!isOpen(view, sc, sr)) return seen;
  const stack: [number, number][] = [[sc, sr]];
  seen.add(`${sc},${sr}`);
  while (stack.length > 0) {
    const [c, r] = stack.pop() as [number, number];
    for (const dir of CARDINALS) {
      const [nc, nr] = stepTile(view, c, r, dir);
      if (isOpen(view, nc, nr) && !seen.has(`${nc},${nr}`)) {
        seen.add(`${nc},${nr}`);
        stack.push([nc, nr]);
      }
    }
  }
  return seen;
}

/**
 * Every tile a PREDATOR can reach from any of `sources`, over corridor, den
 * interior and gate tiles alike.
 *
 * specs/maze.md's reachable-den rule is about this graph: the forager's start
 * tile is reachable from every den-interior tile, so a predator that leaves the
 * den can reach the forager. Seeded from the den tiles, a set that does not hold
 * the forager's start tile is a chamber walled off from the corridors.
 */
export function predatorReachable(
  view: MazeView,
  sources: readonly Tile[],
): Set<string> {
  const seen = new Set<string>();
  const stack: [number, number][] = [];
  for (const { tx, ty } of sources) {
    if (isPredOpen(view, tx, ty) && !seen.has(`${tx},${ty}`)) {
      seen.add(`${tx},${ty}`);
      stack.push([tx, ty]);
    }
  }
  while (stack.length > 0) {
    const [c, r] = stack.pop() as [number, number];
    for (const dir of CARDINALS) {
      const [nc, nr] = stepTile(view, c, r, dir);
      if (isPredOpen(view, nc, nr) && !seen.has(`${nc},${nr}`)) {
        seen.add(`${nc},${nr}`);
        stack.push([nc, nr]);
      }
    }
  }
  return seen;
}

/**
 * Every corridor tile with fewer than two corridor neighbors.
 *
 * specs/maze.md: every corridor tile has at least two, so the forager passes
 * through a tile and comes back around another way. A conforming layout answers
 * an empty list.
 */
export function deadEnds(view: MazeView): Tile[] {
  return openTiles(view).filter(
    ({ tx, ty }) => openNeighborDirs(view, tx, ty).length < 2,
  );
}

/** Corridor tiles with three or more corridor neighbors: the junctions. */
export function junctions(view: MazeView): Tile[] {
  return openTiles(view).filter(
    ({ tx, ty }) => openNeighborDirs(view, tx, ty).length >= 3,
  );
}

/* -------------------------------------------------------------------------- */
/* The proportions                                                            */
/* -------------------------------------------------------------------------- */
//
// specs/maze.md bounds three measures, each computed over the corridor tiles
// alone with the den interior and the den gate excluded from both the tiles
// measured and the neighbors counted. The BOUNDS are not here: a check states
// the bound it asserts, from `src/constants.ts`'s `MAZE_*` figures, so a reader
// of the check sees the whole of what it required.

/**
 * The mean number of corridor neighbors per corridor tile.
 *
 * specs/maze.md's openness: the total corridor-neighbor count over every
 * corridor tile, divided by the number of corridor tiles. `0` for a layout with
 * no corridor at all.
 */
export function openness(view: MazeView): number {
  const tiles = openTiles(view);
  if (tiles.length === 0) return 0;
  let sum = 0;
  for (const { tx, ty } of tiles) sum += openNeighborDirs(view, tx, ty).length;
  return sum / tiles.length;
}

/**
 * The mean corridor-run length, in tiles.
 *
 * specs/maze.md's corridor run: a maximal group of corridor tiles that each have
 * exactly two corridor neighbors and that are connected to one another as
 * neighbors, and its length is the number of tiles in it. A layout with no
 * two-neighbor tile at all has no runs, and answers `0`, which reads as
 * maximally grid-like.
 */
export function meanCorridorRun(view: MazeView): number {
  const key = (c: number, r: number): string => `${c},${r}`;
  const straight = new Set(
    openTiles(view)
      .filter(({ tx, ty }) => openNeighborDirs(view, tx, ty).length === 2)
      .map(({ tx, ty }) => key(tx, ty)),
  );
  const seen = new Set<string>();
  const runs: number[] = [];
  for (const { tx, ty } of openTiles(view)) {
    if (!straight.has(key(tx, ty)) || seen.has(key(tx, ty))) continue;
    let size = 0;
    const stack: [number, number][] = [[tx, ty]];
    seen.add(key(tx, ty));
    while (stack.length > 0) {
      const [c, r] = stack.pop() as [number, number];
      size += 1;
      for (const dir of CARDINALS) {
        const [nc, nr] = stepTile(view, c, r, dir);
        if (straight.has(key(nc, nr)) && !seen.has(key(nc, nr))) {
          seen.add(key(nc, nr));
          stack.push([nc, nr]);
        }
      }
    }
    runs.push(size);
  }
  if (runs.length === 0) return 0;
  return runs.reduce((sum, size) => sum + size, 0) / runs.length;
}

/**
 * Corridor tiles over the cells inside the border.
 *
 * specs/maze.md's density: the number of corridor tiles divided by
 * `(cols - 2) * (rows - 2)`.
 */
export function density(view: MazeView): number {
  const interior = (view.grid.rows - 2) * (view.grid.cols - 2);
  return interior > 0 ? openTiles(view).length / interior : 0;
}

/** The three proportions specs/maze.md bounds, measured together. */
export function mazeProportions(view: MazeView): {
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

/* -------------------------------------------------------------------------- */
/* The den                                                                    */
/* -------------------------------------------------------------------------- */

/** Every den-interior tile, in reading order. */
export function denTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      if (tileAt(view, c, r) === "d") out.push({ tx: c, ty: r });
    }
  }
  return out;
}

/** Every den-gate tile, in reading order. specs/maze.md fixes exactly one. */
export function gateTiles(view: MazeView): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < view.grid.rows; r += 1) {
    for (let c = 0; c < view.grid.cols; c += 1) {
      if (tileAt(view, c, r) === "g") out.push({ tx: c, ty: r });
    }
  }
  return out;
}

/**
 * Den-interior tiles that touch open corridor directly.
 *
 * specs/maze.md encloses the chamber: no den-interior tile has a corridor
 * neighbor, so the gate is its only opening. A conforming layout answers an
 * empty list.
 */
export function denCorridorBreaches(view: MazeView): Tile[] {
  return denTiles(view).filter(({ tx, ty }) =>
    CARDINALS.some((dir) => {
      const [nc, nr] = stepTile(view, tx, ty, dir);
      return isOpen(view, nc, nr);
    }),
  );
}

/**
 * A corridor tile beside a den gate, and the heading that points from it into
 * the gate, or `null` when the layout carries no gate with a corridor beside it.
 */
export function gateApproach(view: MazeView): (Tile & { dir: Dir }) | null {
  for (const gate of gateTiles(view)) {
    for (const dir of CARDINALS) {
      const [nc, nr] = stepTile(view, gate.tx, gate.ty, dir);
      if (isOpen(view, nc, nr)) {
        return { tx: nc, ty: nr, dir: OPPOSITE[dir] };
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Corridor distance and sight lines                                          */
/* -------------------------------------------------------------------------- */

/**
 * Corridor distance in tiles from `from` to every corridor tile within
 * `maxDist` steps, as a map keyed `"c,r"`.
 *
 * This is the adjacency a sonar pulse floods along: specs/sensing.md has a pulse
 * travel "from the forager's tile through open tiles alone, following the
 * corridors, out to a path range of `E` corridor steps", and the Gloamfin's ping
 * travels the same graph.
 */
export function corridorDistances(
  view: MazeView,
  from: Tile,
  maxDist = 12,
): Map<string, number> {
  const key = (c: number, r: number): string => `${c},${r}`;
  const dist = new Map<string, number>([[key(from.tx, from.ty), 0]]);
  let frontier: [number, number][] = [[from.tx, from.ty]];
  let d = 0;
  while (frontier.length > 0 && d < maxDist) {
    const next: [number, number][] = [];
    for (const [c, r] of frontier) {
      for (const dir of CARDINALS) {
        const [nc, nr] = stepTile(view, c, r, dir);
        if (isOpen(view, nc, nr) && !dist.has(key(nc, nr))) {
          dist.set(key(nc, nr), d + 1);
          next.push([nc, nr]);
        }
      }
    }
    frontier = next;
    d += 1;
  }
  return dist;
}

/**
 * Every tile the segment joining two tile centers passes through, in order from
 * `from` to `to`, both ends included.
 *
 * specs/sensing.md fixes the forager's light as a straight line: a tile is lit
 * when its center lies within `V` of the forager's center "and the segment
 * joining those two centers crosses no rock tile other than that tile itself".
 * That is a statement about the SEGMENT, not about a particular way of walking a
 * grid, so this walks the cells the segment really enters, stepping to whichever
 * of the next column boundary or the next row boundary the segment reaches
 * first, and taking both when it passes exactly through a corner.
 */
export function segmentTiles(grid: Grid, from: Tile, to: Tile): Tile[] {
  const a = tileCenter(grid, from.tx, from.ty);
  const b = tileCenter(grid, to.tx, to.ty);
  const path: Tile[] = [{ tx: from.tx, ty: from.ty }];
  let tx = from.tx;
  let ty = from.ty;
  const stepX = Math.sign(to.tx - from.tx);
  const stepY = Math.sign(to.ty - from.ty);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // How far along the segment, as a fraction in [0, 1], the next boundary lies.
  const nextT = (
    coordinate: number,
    origin: number,
    delta: number,
    index: number,
    step: number,
  ): number => {
    if (step === 0) return Number.POSITIVE_INFINITY;
    const edge =
      origin + (step > 0 ? (index + 1) * grid.tile : index * grid.tile);
    return (edge - coordinate) / delta;
  };
  let guard = 0;
  const limit = 4 * (Math.abs(to.tx - from.tx) + Math.abs(to.ty - from.ty) + 2);
  while ((tx !== to.tx || ty !== to.ty) && guard < limit) {
    guard += 1;
    const tX = nextT(a.x, grid.originX, dx, tx, stepX);
    const tY = nextT(a.y, grid.originY, dy, ty, stepY);
    if (!Number.isFinite(tX) && !Number.isFinite(tY)) break;
    // A corner the segment passes exactly through enters both cells, so both are
    // reported and the caller's rock test sees whichever of them is solid.
    if (Math.abs(tX - tY) < 1e-9) {
      tx += stepX;
      ty += stepY;
    } else if (tX < tY) {
      tx += stepX;
    } else {
      ty += stepY;
    }
    path.push({ tx, ty });
  }
  return path;
}

/**
 * The segment joining the two tile centers crosses no rock tile other than `to`
 * itself: the sight line specs/sensing.md fixes for the forager's light.
 */
export function sightLineClear(view: MazeView, from: Tile, to: Tile): boolean {
  return segmentTiles(view.grid, from, to).every(
    (tile) =>
      (tile.tx === to.tx && tile.ty === to.ty) ||
      !isWall(view, tile.tx, tile.ty),
  );
}

/**
 * How much of the segment joining two tile centers runs through rock, in logical
 * units.
 *
 * {@link sightLineClear} answers a yes/no question, and two conforming builds
 * can honestly disagree about it where a segment clips the very corner of a rock
 * tile: the specification fixes the geometry and not the arithmetic a build
 * traces it with. This measures the same geometry as a QUANTITY, so a scenario
 * can pose a pair occluded by a margin no reasonable tracer disagrees about
 * rather than one that merely satisfies this module's own tie-break.
 */
export function wallSpan(view: MazeView, from: Tile, to: Tile): number {
  const a = tileCenter(view.grid, from.tx, from.ty);
  const b = tileCenter(view.grid, to.tx, to.ty);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // 2-unit steps: fine enough that a sliver of rock is not stepped over, coarse
  // enough that the longest line on the grid is a few hundred samples.
  const n = Math.max(1, Math.round(length / 2));
  let inside = 0;
  for (let i = 1; i < n; i += 1) {
    const x = a.x + ((b.x - a.x) * i) / n;
    const y = a.y + ((b.y - a.y) * i) / n;
    const { tx, ty } = tileOf(view.grid, x, y);
    if (isWall(view, tx, ty)) inside += 1;
  }
  return (inside / n) * length;
}

/** The straight-line distance between two tile centers, in logical units. */
export function tileGap(grid: Grid, a: Tile, b: Tile): number {
  const p = tileCenter(grid, a.tx, a.ty);
  const q = tileCenter(grid, b.tx, b.ty);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * How remote two tiles are: the SMALLER of the straight-line gap and the
 * corridor path between them, in logical units.
 *
 * A flare's radius ignores walls while a chase closes along corridors, and the
 * wrap tunnel joins two mouths that are a whole board apart on the screen. A
 * scenario that wants a creature out of reach wants both readings to be large,
 * so the honest score is the smaller one. A pair with no corridor path within
 * `maxSteps` scores by the straight line alone.
 */
export function remoteness(
  view: MazeView,
  a: Tile,
  b: Tile,
  maxSteps = 40,
): number {
  const straight = tileGap(view.grid, a, b);
  const steps = corridorDistances(view, a, maxSteps).get(`${b.tx},${b.ty}`);
  if (steps === undefined) return straight;
  return Math.min(straight, steps * view.grid.tile);
}
