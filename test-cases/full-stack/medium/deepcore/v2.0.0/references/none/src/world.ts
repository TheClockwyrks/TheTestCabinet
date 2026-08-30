// Deepcore — the mine: its coordinate helpers and its generation (specs/world.md).
//
// Generation draws every choice from the generator it is handed, so the same seed and
// the same sequence of calls rebuild the same mine exactly. It scatters ore at one
// constant share, stone and gas from the rockbed down and lava from the deepstone down
// at shares that rise with depth, pools the lava rather than scattering it, and places
// exactly one Resonite node and one Cryenite node. Two guarantees close it out: a
// diggable, lava-free route from the cave mouth to both nodes and the Core, and no band
// sealed across its width.

import {
  BAND_HEALTH,
  CAVE_MOUTH_COL,
  CORE_COL,
  DEEPSTONE_TOP_FRACTION,
  MATERIAL_BAND,
  ORES,
  ORE_DENSITY,
  ORE_IDS,
  ORE_MIN_ROW,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  SURFACE_ROW,
  TILE,
  WORLD_COLS,
  bandAtFraction,
  depthFraction,
  gasDensityAt,
  lavaDensityAt,
  oreWeightAt,
  stoneDensityAt,
} from "./constants";
import type { Rng } from "./rng";
import type { Band, Material, Ore, Tile, TileKind } from "./types";

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

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

/** The band a row belongs to. Rows at or above the surface read as topsoil. */
export function bandForRow(row: number, coreRow: number): Band {
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
 * Kinds the drill removes. Everything solid but the bedrock border and unbreakable
 * stone. Lava is minable: the drill bores through it at a hull cost.
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
 * generation guarantee routes over these alone, so a player is never forced to drill
 * lava or blast a boulder to reach a node or the Core.
 */
export function isRouteRock(kind: TileKind): boolean {
  return isMinableKind(kind) && kind !== "lava";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** A buried material node the scanner targets. */
export interface MaterialNode {
  material: "resonite" | "cryenite";
  col: number;
  row: number;
  collected: boolean;
}

export interface Mine {
  /** grid[row][col]. */
  grid: Tile[][];
  /** The two buried material nodes. */
  nodes: MaterialNode[];
}

/** Cells a lava pool grows to, so lava reads as pools rather than single cells. */
const LAVA_POOL_SIZE = 4;

function makeTile(kind: TileKind, band: Band): Tile {
  return { kind, band };
}

/** The which-ore draw at a depth fraction, over every ore whose curve reaches it. */
function drawOre(rng: Rng, f: number): Ore | null {
  const ores: Ore[] = [];
  const weights: number[] = [];
  for (const id of ORE_IDS) {
    const w = oreWeightAt(ORES[id], f);
    if (w > 0) {
      ores.push(id);
      weights.push(w);
    }
  }
  if (!ores.length) return null;
  return rng.weighted(ores, weights);
}

/** Generate a fresh mine of `coreRow` depth, drawing every choice from `rng`. */
export function generateMine(rng: Rng, coreRow: number): Mine {
  const grid: Tile[][] = [];
  const rows = coreRow + 1;

  for (let row = 0; row < rows; row++) {
    const band = bandForRow(row, coreRow);
    const line: Tile[] = [];
    for (let col = 0; col < WORLD_COLS; col++) {
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

  // Stone, gas, and ore, one draw per cell against the cumulative shares, so each
  // kind's share of the minable cells is the one its rule states.
  for (let row = 1; row < coreRow; row++) {
    const f = depthFraction(row, coreRow);
    const band = bandForRow(row, coreRow);
    const stone = stoneDensityAt(f);
    const gas = gasDensityAt(f);
    const ore = row >= ORE_MIN_ROW ? ORE_DENSITY : 0;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col++) {
      const u = rng.next();
      if (u < stone) {
        grid[row]![col] = makeTile("stone", band);
      } else if (u < stone + gas) {
        grid[row]![col] = makeTile("gas", band);
      } else if (u < stone + gas + ore) {
        const id = drawOre(rng, f);
        if (id) {
          const tile = makeTile("ore", band);
          tile.ore = id;
          grid[row]![col] = tile;
        }
      }
    }
  }

  placeLava(grid, rng, coreRow);

  // The way down out of the camp.
  grid[1]![CAVE_MOUTH_COL] = makeTile("tunnel", bandForRow(1, coreRow));

  const nodes: MaterialNode[] = [];
  placeNode(grid, rng, nodes, "resonite", coreRow);
  placeNode(grid, rng, nodes, "cryenite", coreRow);

  openSealedBands(grid, rng, coreRow);

  const targets = nodes.map((n) => ({ col: n.col, row: n.row }));
  targets.push({ col: CORE_COL, row: coreRow });
  repairConnectivity(grid, coreRow, targets);

  return { grid, nodes };
}

/**
 * Scatter lava from the deepstone down as pools: a seed drawn at the row's share over
 * the pool size, grown outward into neighbouring rock so a pool covers several cells.
 */
function placeLava(grid: Tile[][], rng: Rng, coreRow: number): void {
  const firstRow = Math.max(
    1,
    Math.ceil(DEEPSTONE_TOP_FRACTION * (coreRow - 1)) + 1,
  );
  for (let row = firstRow; row < coreRow; row++) {
    const f = depthFraction(row, coreRow);
    const seedChance = lavaDensityAt(f) / LAVA_POOL_SIZE;
    if (seedChance <= 0) continue;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col++) {
      if (!rng.chance(seedChance)) continue;
      growPool(grid, rng, col, row, firstRow, coreRow);
    }
  }
}

/** Grow one lava pool outward from a seed cell over plain rock and ore. */
function growPool(
  grid: Tile[][],
  rng: Rng,
  col: number,
  row: number,
  firstRow: number,
  coreRow: number,
): void {
  const frontier: [number, number][] = [[col, row]];
  let placed = 0;
  while (frontier.length && placed < LAVA_POOL_SIZE) {
    const i = rng.int(0, frontier.length - 1);
    const [c, r] = frontier.splice(i, 1)[0]!;
    if (c < PLAYABLE_COL_MIN || c > PLAYABLE_COL_MAX) continue;
    if (r < firstRow || r >= coreRow) continue;
    const kind = grid[r]![c]!.kind;
    if (kind !== "rock" && kind !== "ore") continue;
    grid[r]![c] = makeTile("lava", bandForRow(r, coreRow));
    placed++;
    frontier.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
}

/** Place one material node at a random minable cell of its band. */
function placeNode(
  grid: Tile[][],
  rng: Rng,
  nodes: MaterialNode[],
  material: "resonite" | "cryenite",
  coreRow: number,
): void {
  const band = MATERIAL_BAND[material];
  const index = ["topsoil", "rockbed", "deepstone", "coreshell"].indexOf(band);
  const rowMin = Math.max(1, Math.round((index / 4) * (coreRow - 1)) + 1);
  const rowMax = Math.min(
    coreRow - 1,
    Math.round(((index + 1) / 4) * (coreRow - 1)),
  );
  for (let guard = 0; guard < 4000; guard++) {
    const row = rng.int(rowMin, rowMax);
    const col = rng.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
    const tile = grid[row]![col]!;
    if (tile.kind !== "rock" && tile.kind !== "ore") continue;
    if (nodes.some((n) => n.col === col && n.row === row)) continue;
    const placed = makeTile("material", tile.band);
    placed.material = material;
    grid[row]![col] = placed;
    nodes.push({ material, col, row, collected: false });
    return;
  }
  // The band is packed solid, which the shares above make impossible; fall back to a
  // cell the search would have accepted so the node is always present.
  const row = Math.min(coreRow - 1, Math.max(1, rowMin));
  const col = PLAYABLE_COL_MIN;
  const placed = makeTile("material", bandForRow(row, coreRow));
  placed.material = material;
  grid[row]![col] = placed;
  nodes.push({ material, col, row, collected: false });
}

/** Make sure no row is sealed across its width by lava and unbreakable stone. */
function openSealedBands(grid: Tile[][], rng: Rng, coreRow: number): void {
  for (let row = 1; row < coreRow; row++) {
    let open = 0;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col++) {
      if (isRouteRock(grid[row]![col]!.kind)) open++;
    }
    if (open > 0) continue;
    const col = rng.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
    grid[row]![col] = makeTile("rock", bandForRow(row, coreRow));
  }
}

/**
 * Guarantee every target is reachable from the cave mouth over cells that are minable
 * and not lava. Where one is not, carve the lava and stone along a shortest path back
 * to the reachable region into plain rock.
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
    const kind = grid[r]![c]!.kind;
    return kind === "tunnel" || isRouteRock(kind);
  };

  const reach = (): Set<number> => {
    const seen = new Set<number>();
    const stack: [number, number][] = [[CAVE_MOUTH_COL, 1]];
    seen.add(key(CAVE_MOUTH_COL, 1));
    while (stack.length) {
      const [c, r] = stack.pop()!;
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

  for (let pass = 0; pass < 8; pass++) {
    const reachable = reach();
    const missing = targets.filter((t) => !reachable.has(key(t.col, t.row)));
    if (!missing.length) return;
    const target = missing[0]!;
    // Walk out from the target through anything but bedrock until the reachable
    // region is met, then carve the barriers the path crossed.
    const prev = new Map<number, number>();
    const queue: [number, number][] = [[target.col, target.row]];
    const start = key(target.col, target.row);
    prev.set(start, -1);
    let met = -1;
    while (queue.length) {
      const [c, r] = queue.shift()!;
      const here = key(c, r);
      if (reachable.has(here)) {
        met = here;
        break;
      }
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= WORLD_COLS || nr < 0 || nr >= rows) continue;
        if (grid[nr]![nc]!.kind === "bedrock") continue;
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
      const kind = grid[r]![c]!.kind;
      if (kind === "lava" || kind === "stone") {
        grid[r]![c] = makeTile("rock", bandForRow(r, coreRow));
      }
      node = prev.get(node) ?? -1;
    }
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * An empty mine: the bedrock border, the camp row, and the Core chamber stand, and
 * every playable cell between them is an open tunnel.
 */
export function emptyMine(coreRow: number): Tile[][] {
  const grid: Tile[][] = [];
  for (let row = 0; row <= coreRow; row++) {
    const band = bandForRow(row, coreRow);
    const line: Tile[] = [];
    for (let col = 0; col < WORLD_COLS; col++) {
      if (col === 0 || col === WORLD_COLS - 1)
        line.push(makeTile("bedrock", band));
      else if (row === coreRow)
        line.push(makeTile(col === CORE_COL ? "core" : "bedrock", "coreshell"));
      else line.push(makeTile("tunnel", band));
    }
    grid.push(line);
  }
  return grid;
}

/** The world x the miner's box sits at when it stands centered on a column. */
export function colCenterX(col: number, width: number): number {
  return tileLeft(col) + (TILE - width) / 2;
}

/** The material an exotic material id names, for the satchel's two countable kinds. */
export function isCountableMaterial(m: Material): m is "resonite" | "cryenite" {
  return m === "resonite" || m === "cryenite";
}

/** The column the miner spawns above. */
export const SPAWN_COLUMN = SPAWN_COL;
