// Deepcore — the mine: its coordinate helpers and its generation
// (specs/world.md).
//
// Generation draws every choice from the cursor it is handed, so the same seed
// and the same sequence of calls rebuild the same mine exactly. It scatters ore
// at one constant share, stone and gas from the rockbed down and lava from the
// deepstone down at shares that rise with depth, pools the lava rather than
// scattering it, and places exactly one Resonite node and one Cryenite node. Two
// guarantees close it out: a diggable, lava-free route from the cave mouth to
// both nodes and the Core, and no band sealed across its width.
//
// A generated grid is built as ordinary mutable arrays and handed over as the
// immutable `Grid` the state holds. Nothing outside this module writes to a grid
// it did not build; a cell is replaced through `src/state.ts`'s copy-on-write.

import {
  BAND_HEALTH,
  CAVE_MOUTH_COL,
  CORE_COL,
  FUEL_TIERS,
  HULL_TIERS,
  MATERIAL_BAND,
  MINER_H,
  MINER_W,
  MINERALS,
  ORE_DENSITY,
  ORE_MIN_ROW,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  SURFACE_Y,
  TILE,
  WORLD_COLS,
} from "./constants";
import type { BandName, MaterialId, OreId, TileKind } from "./constants";
import type {
  DeepcoreState,
  Grid,
  MaterialNode,
  Miner,
  Tile,
  UpgradeTiers,
} from "./game";
import type { Draws } from "./rng";
import {
  bandAtFraction,
  DEEPSTONE_TOP_FRACTION,
  depthFraction,
  gasDensityAt,
  lavaDensityAt,
  mineralWeightAt,
  stoneDensityAt,
  SURFACE_ROW,
} from "./tuning";

// ---- Coordinates ---------------------------------------------------------

/** World x of a column's left edge. */
export function tileLeft(col: number): number {
  return col * TILE;
}

/** World y of a row's top edge. */
export function tileTop(row: number): number {
  return row * TILE;
}

/** The column a world x falls in. */
export function colAtX(x: number): number {
  return Math.floor(x / TILE);
}

/** The row a world y falls in. */
export function rowAtY(y: number): number {
  return Math.floor(y / TILE);
}

/** The world x a box of `width` sits at when it stands centered on a column. */
export function colCenterX(col: number, width: number): number {
  return tileLeft(col) + (TILE - width) / 2;
}

/** The world center of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: tileLeft(col) + TILE / 2, y: tileTop(row) + TILE / 2 };
}

/** The band a row belongs to. Rows at or above the surface read as topsoil. */
export function bandForRow(row: number, coreRow: number): BandName {
  if (row <= SURFACE_ROW) return "topsoil";
  if (row >= coreRow) return "coreshell";
  return bandAtFraction(depthFraction(row, coreRow));
}

/** The full health of a minable cell, from its band. */
export function tileMaxHealth(tile: Tile): number {
  return BAND_HEALTH[tile.band];
}

/** Kinds the miner cannot pass into. */
export function isSolidKind(kind: TileKind): boolean {
  return kind !== "tunnel";
}

/**
 * Kinds the drill removes: everything solid but the bedrock border and
 * unbreakable stone. Lava is minable — the drill bores through it at a hull
 * cost.
 */
export function isMinableKind(kind: TileKind): boolean {
  return (
    kind === "rock" ||
    kind === "ore" ||
    kind === "material" ||
    kind === "gas" ||
    kind === "core" ||
    kind === "lava"
  );
}

/**
 * True for a cell an ordinary route may run through: minable and not lava. The
 * generation guarantee routes over these alone, so a player is never forced to
 * drill lava or blast a boulder to reach a node or the Core.
 */
export function isRouteRock(kind: TileKind): boolean {
  return isMinableKind(kind) && kind !== "lava";
}

// ---- Building a cell -----------------------------------------------------

/** A fresh cell of a kind and a band, carrying nothing and undrilled. */
export function makeTile(kind: TileKind, band: BandName): Tile {
  return { kind, band, ore: null, material: null, health: null };
}

/** A fresh ore vein holding one mineral, at its band's full health. */
export function makeOreTile(band: BandName, ore: OreId): Tile {
  return { kind: "ore", band, ore, material: null, health: BAND_HEALTH[band] };
}

/** A fresh material node holding one material, at its band's full health. */
export function makeMaterialTile(band: BandName, material: MaterialId): Tile {
  return {
    kind: "material",
    band,
    ore: null,
    material,
    health: BAND_HEALTH[band],
  };
}

/**
 * A fresh cell of a kind, at its band's full health where the kind is minable.
 * The cell it replaces is gone, along with whatever ore, material, or health it
 * held.
 */
export function freshCell(kind: TileKind, band: BandName): Tile {
  const tile = makeTile(kind, band);
  return isMinableKind(kind) ? { ...tile, health: BAND_HEALTH[band] } : tile;
}

// ---- The miner at rest ---------------------------------------------------

/** The miner as an expedition opens: at rest, facing east, tank and hull full. */
export function restingMiner(tiers: UpgradeTiers): Miner {
  return {
    x: colCenterX(SPAWN_COL, MINER_W),
    y: SURFACE_Y - MINER_H,
    vx: 0,
    vy: 0,
    facing: "east",
    state: "idle",
    fuel: FUEL_TIERS[tiers.fuel - 1] ?? FUEL_TIERS[0],
    hull: HULL_TIERS[tiers.hull - 1] ?? HULL_TIERS[0],
    drilling: null,
    travel: true,
    drill: true,
  };
}

/** Stand the miner on the camp ground above `SPAWN_COL`, at rest, facing east. */
export function placeMinerAtSpawn(state: DeepcoreState): DeepcoreState {
  return {
    ...state,
    miner: {
      ...state.miner,
      x: colCenterX(SPAWN_COL, MINER_W),
      y: SURFACE_Y - MINER_H,
      vx: 0,
      vy: 0,
      facing: "east",
      state: "idle",
      drilling: null,
    },
  };
}

// ---- Generation ----------------------------------------------------------

/** A freshly generated mine: the grid and the two buried material nodes. */
export interface Mine {
  readonly grid: Grid;
  readonly nodes: readonly MaterialNode[];
}

/** Cells a lava pool grows to, so lava reads as pools rather than single cells. */
const LAVA_POOL_SIZE = 4;

/** The number of playable columns one row holds. */
const PLAYABLE_COLS = PLAYABLE_COL_MAX - PLAYABLE_COL_MIN + 1;

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The which-mineral draw at a depth fraction, over every curve that reaches it. */
function drawMineral(draws: Draws, f: number): OreId | null {
  const ids: OreId[] = [];
  const weights: number[] = [];
  for (const mineral of MINERALS) {
    const weight = mineralWeightAt(mineral, f);
    if (weight > 0) {
      ids.push(mineral.id);
      weights.push(weight);
    }
  }
  if (ids.length === 0) return null;
  return draws.weighted(ids, weights);
}

/**
 * An empty mine: the bedrock border, the camp row, and the Core chamber stand,
 * and every playable cell between them is an open tunnel.
 */
export function emptyMine(coreRow: number): Grid {
  const grid: Tile[][] = [];
  for (let row = 0; row <= coreRow; row += 1) {
    const band = bandForRow(row, coreRow);
    const line: Tile[] = [];
    for (let col = 0; col < WORLD_COLS; col += 1) {
      if (col === 0 || col === WORLD_COLS - 1) {
        line.push(makeTile("bedrock", band));
      } else if (row === coreRow) {
        line.push(makeTile(col === CORE_COL ? "core" : "bedrock", "coreshell"));
      } else {
        line.push(makeTile("tunnel", band));
      }
    }
    grid.push(line);
  }
  return grid;
}

/** Generate a fresh mine of `coreRow` depth, drawing every choice from `draws`. */
export function generateMine(draws: Draws, coreRow: number): Mine {
  const grid: Tile[][] = [];
  const rows = coreRow + 1;

  for (let row = 0; row < rows; row += 1) {
    const band = bandForRow(row, coreRow);
    const line: Tile[] = [];
    for (let col = 0; col < WORLD_COLS; col += 1) {
      if (col === 0 || col === WORLD_COLS - 1) {
        line.push(makeTile("bedrock", band));
      } else if (row === SURFACE_ROW) {
        line.push(makeTile("tunnel", "topsoil"));
      } else if (row === coreRow) {
        line.push(makeTile(col === CORE_COL ? "core" : "bedrock", "coreshell"));
      } else {
        line.push(makeTile("rock", band));
      }
    }
    grid.push(line);
  }

  // Lava first, because it pools across rows and the others are placed a row at
  // a time into what it leaves. Each kind is placed at the exact count its share
  // states, carrying the fractional remainder from row to row, so a band's
  // measured share is the stated one rather than a sample of it.
  placeLava(grid, draws, coreRow);
  scatter(grid, draws, coreRow, "stone", stoneDensityAt);
  scatter(grid, draws, coreRow, "gas", gasDensityAt);
  scatterOre(grid, draws, coreRow);

  // The way down out of the camp.
  grid[1][CAVE_MOUTH_COL] = makeTile("tunnel", bandForRow(1, coreRow));

  const nodes: MutableNode[] = [];
  placeNode(grid, draws, nodes, "resonite", coreRow);
  placeNode(grid, draws, nodes, "cryenite", coreRow);

  openSealedBands(grid, draws, coreRow);

  const targets = nodes.map((node) => ({ col: node.col, row: node.row }));
  targets.push({ col: CORE_COL, row: coreRow });
  repairConnectivity(grid, coreRow, targets);

  return { grid, nodes };
}

/** A node under construction, before the mine is handed over as a value. */
interface MutableNode {
  material: MaterialId;
  col: number;
  row: number;
  collected: boolean;
}

/** The playable cells of a row that still hold plain rock. */
function plainRockCols(grid: Tile[][], row: number): number[] {
  const cols: number[] = [];
  for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
    if (grid[row][col].kind === "rock") cols.push(col);
  }
  return cols;
}

/**
 * Turn the stated share of each row's playable cells into `kind`. The fractional
 * remainder carries to the next row, so the count over a band is the share the
 * rule states rather than a draw around it.
 */
function scatter(
  grid: Tile[][],
  draws: Draws,
  coreRow: number,
  kind: TileKind,
  densityAt: (f: number) => number,
): void {
  let owed = 0;
  for (let row = 1; row < coreRow; row += 1) {
    owed += densityAt(depthFraction(row, coreRow)) * PLAYABLE_COLS;
    const want = Math.floor(owed);
    if (want <= 0) continue;
    const cols = plainRockCols(grid, row);
    const take = Math.min(want, cols.length);
    for (let i = 0; i < take; i += 1) {
      const pick = draws.int(i, cols.length - 1);
      const col = cols[pick];
      cols[pick] = cols[i];
      cols[i] = col;
      grid[row][col] = makeTile(kind, bandForRow(row, coreRow));
    }
    owed -= take;
  }
}

/** Turn `ORE_DENSITY` of each row's playable cells into a vein, from `ORE_MIN_ROW`. */
function scatterOre(grid: Tile[][], draws: Draws, coreRow: number): void {
  let owed = 0;
  for (let row = ORE_MIN_ROW; row < coreRow; row += 1) {
    owed += ORE_DENSITY * PLAYABLE_COLS;
    const want = Math.floor(owed);
    if (want <= 0) continue;
    const f = depthFraction(row, coreRow);
    const cols = plainRockCols(grid, row);
    const take = Math.min(want, cols.length);
    let placed = 0;
    for (let i = 0; i < take; i += 1) {
      const pick = draws.int(i, cols.length - 1);
      const col = cols[pick];
      cols[pick] = cols[i];
      cols[i] = col;
      const id = drawMineral(draws, f);
      if (!id) break;
      grid[row][col] = makeOreTile(bandForRow(row, coreRow), id);
      placed += 1;
    }
    owed -= placed;
  }
}

/**
 * Scatter lava from the deepstone down as pools rather than single cells: a pool
 * of `LAVA_POOL_SIZE` cells is grown wherever the running count falls behind the
 * share the rows so far have asked for.
 */
function placeLava(grid: Tile[][], draws: Draws, coreRow: number): void {
  const firstRow = Math.max(
    1,
    Math.ceil(DEEPSTONE_TOP_FRACTION * (coreRow - 1)) + 1,
  );
  let owed = 0;
  for (let row = firstRow; row < coreRow; row += 1) {
    owed += lavaDensityAt(depthFraction(row, coreRow)) * PLAYABLE_COLS;
    let guard = 0;
    while (owed >= 1 && guard < PLAYABLE_COLS) {
      guard += 1;
      const col = draws.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
      const grown = growPool(
        grid,
        draws,
        col,
        row,
        firstRow,
        coreRow,
        Math.round(owed),
      );
      if (grown === 0) break;
      owed -= grown;
    }
  }
}

/** Grow one lava pool outward from a seed cell over plain rock. */
function growPool(
  grid: Tile[][],
  draws: Draws,
  col: number,
  row: number,
  firstRow: number,
  coreRow: number,
  budget: number,
): number {
  const size = Math.min(LAVA_POOL_SIZE, Math.max(1, budget));
  const frontier: [number, number][] = [[col, row]];
  let placed = 0;
  while (frontier.length > 0 && placed < size) {
    const i = draws.int(0, frontier.length - 1);
    const [c, r] = frontier.splice(i, 1)[0];
    if (c < PLAYABLE_COL_MIN || c > PLAYABLE_COL_MAX) continue;
    if (r < firstRow || r >= coreRow) continue;
    if (grid[r][c].kind !== "rock") continue;
    grid[r][c] = makeTile("lava", bandForRow(r, coreRow));
    placed += 1;
    frontier.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return placed;
}

/** Place one material node at a random minable cell of its band. */
function placeNode(
  grid: Tile[][],
  draws: Draws,
  nodes: MutableNode[],
  material: MaterialId,
  coreRow: number,
): void {
  const band = MATERIAL_BAND[material];
  const index = ["topsoil", "rockbed", "deepstone", "coreshell"].indexOf(band);
  // The band rule is `floor(4 * (row - 1) / (coreRow - 1))`, so the shallowest row
  // of band `i` is `1 + ceil(i * (coreRow - 1) / 4)`. Rounding instead starts the
  // range one row too shallow wherever that product's fraction is under a half,
  // which on the quick mine puts the rockbed's first row at 63, a topsoil row.
  const rowMin = Math.max(1, Math.ceil((index / 4) * (coreRow - 1)) + 1);
  const rowMax = Math.min(
    coreRow - 1,
    Math.round(((index + 1) / 4) * (coreRow - 1)),
  );
  for (let guard = 0; guard < 4000; guard += 1) {
    const row = draws.int(rowMin, rowMax);
    const col = draws.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
    const tile = grid[row][col];
    // The band rule decides, rather than the range arithmetic agreeing with it.
    if (bandForRow(row, coreRow) !== band) continue;
    if (tile.kind !== "rock" && tile.kind !== "ore") continue;
    if (nodes.some((node) => node.col === col && node.row === row)) continue;
    grid[row][col] = makeMaterialTile(tile.band, material);
    nodes.push({ material, col, row, collected: false });
    return;
  }
  // The band is packed solid, which the shares above make impossible; fall back
  // to a cell the search would have accepted so the node is always present.
  let row = Math.min(coreRow - 1, Math.max(1, rowMin));
  while (row < rowMax && bandForRow(row, coreRow) !== band) row += 1;
  const col = PLAYABLE_COL_MIN;
  grid[row][col] = makeMaterialTile(bandForRow(row, coreRow), material);
  nodes.push({ material, col, row, collected: false });
}

/** Make sure no row is sealed across its width by lava and unbreakable stone. */
function openSealedBands(grid: Tile[][], draws: Draws, coreRow: number): void {
  for (let row = 1; row < coreRow; row += 1) {
    let open = 0;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 1) {
      if (isRouteRock(grid[row][col].kind)) open += 1;
    }
    if (open > 0) continue;
    const col = draws.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
    grid[row][col] = makeTile("rock", bandForRow(row, coreRow));
  }
}

/**
 * Guarantee every target is reachable from the cave mouth over cells that are
 * minable and not lava. Where one is not, carve the lava and stone along a
 * shortest path back to the reachable region into plain rock.
 */
function repairConnectivity(
  grid: Tile[][],
  coreRow: number,
  targets: { col: number; row: number }[],
): void {
  const rows = coreRow + 1;
  const key = (c: number, r: number): number => r * WORLD_COLS + c;

  const routable = (c: number, r: number): boolean => {
    if (c < 0 || c >= WORLD_COLS || r < 0 || r >= rows) return false;
    const kind = grid[r][c].kind;
    return kind === "tunnel" || isRouteRock(kind);
  };

  const reach = (): Set<number> => {
    const seen = new Set<number>();
    const stack: [number, number][] = [[CAVE_MOUTH_COL, 1]];
    seen.add(key(CAVE_MOUTH_COL, 1));
    while (stack.length > 0) {
      const [c, r] = stack.pop() as [number, number];
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!routable(nc, nr)) continue;
        const k = key(nc, nr);
        if (seen.has(k)) continue;
        seen.add(k);
        stack.push([nc, nr]);
      }
    }
    return seen;
  };

  for (let pass = 0; pass < 8; pass += 1) {
    const reachable = reach();
    const missing = targets.filter((t) => !reachable.has(key(t.col, t.row)));
    if (missing.length === 0) return;
    const target = missing[0];
    // Walk out from the target through anything but bedrock until the reachable
    // region is met, then carve the barriers the path crossed.
    const prev = new Map<number, number>();
    const queue: [number, number][] = [[target.col, target.row]];
    const start = key(target.col, target.row);
    prev.set(start, -1);
    let met = -1;
    while (queue.length > 0) {
      const [c, r] = queue.shift() as [number, number];
      const here = key(c, r);
      if (reachable.has(here)) {
        met = here;
        break;
      }
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= WORLD_COLS || nr < 0 || nr >= rows) continue;
        if (grid[nr][nc].kind === "bedrock") continue;
        const k = key(nc, nr);
        if (prev.has(k)) continue;
        prev.set(k, here);
        queue.push([nc, nr]);
      }
    }
    if (met < 0) return;
    let node = prev.get(met) ?? -1;
    while (node !== -1 && node !== start) {
      const c = node % WORLD_COLS;
      const r = Math.floor(node / WORLD_COLS);
      const kind = grid[r][c].kind;
      if (kind === "lava" || kind === "stone") {
        grid[r][c] = makeTile("rock", bandForRow(r, coreRow));
      }
      node = prev.get(node) ?? -1;
    }
  }
}
