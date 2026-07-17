// Deepcore — the mine: per-game generation and the tile/coordinate helpers.
//
// Implements specs/world.md exactly: a 32-column grid whose DEPTH is the chosen world size
// (WORLD.rows — Standard 0..500, Quick half, Marathon double), bedrock border columns 0/31
// and the Core chamber at the deepest row, the four depth bands (equal quarters of the
// descent, scaled with the size) + the Core chamber, ore
// veins at a CONSTANT density with a depth-curve TYPE (never in the first three dirt rows),
// gas from the rockbed down
// and lava from the deepstone down, unbreakable STONE obstacles from the rockbed down (all
// denser with depth), and — GUARANTEED — exactly one Resonite node in the rockbed and one
// Cryenite node in the deepstone at random positions. A final connectivity repair guarantees
// a run is always winnable: every material node and the Core are reachable from the surface
// through minable rock (lava/stone never seal the only route).

import {
  BANDS,
  BAND_ORDER,
  GRID_MARGIN_X,
  MATERIAL_NODES_PER_BAND,
  ORES,
  ORE_DENSITY,
  ORE_FREE_TOP_ROWS,
  oreWeightAtRow,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SURFACE_ROW,
  TILE_SIZE,
  toBaseRow,
  WORLD,
  WORLD_COLS,
} from "./constants";
import type { Band, Material, Ore, Tile } from "./types";
import { Rng } from "./rng";

// ---------------------------------------------------------------------------
// Coordinate helpers (specs/world.md — the tile grid & vertical camera)
// ---------------------------------------------------------------------------

/** World-space x of a column's left edge. */
export function tileLeft(col: number): number {
  return GRID_MARGIN_X + col * TILE_SIZE;
}
/** World-space y of a row's top edge. */
export function tileTop(row: number): number {
  return row * TILE_SIZE;
}
/** Column containing world-space x. */
export function colAtX(x: number): number {
  return Math.floor((x - GRID_MARGIN_X) / TILE_SIZE);
}
/** Row containing world-space y. */
export function rowAtY(y: number): number {
  return Math.floor(y / TILE_SIZE);
}

/**
 * Full health of a minable tile, from its band's `maxHealth` (specs/character.md,
 * specs/upgrades.md). The drill removes this in damage-per-hit chunks; a fresh (undrilled)
 * tile of this band starts here.
 */
export function tileMaxHealth(tile: Tile): number {
  return BANDS[tile.band].maxHealth;
}

/** The band a given row belongs to (rows above/at the surface read as topsoil). The band ROW
 *  spans scale with the world size, so this reads them from the active layout (WORLD.bands). */
export function bandForRow(row: number): Band {
  for (const b of BAND_ORDER) {
    const span = WORLD.bands[b];
    if (row >= span.min && row <= span.max) return b;
  }
  return row <= SURFACE_ROW ? "topsoil" : "coreshell";
}

/** Kinds the miner cannot pass into (blocks movement — specs/character.md collision). */
export function isSolidKind(kind: Tile["kind"]): boolean {
  return (
    kind === "rock" ||
    kind === "ore" ||
    kind === "material" ||
    kind === "gas" ||
    kind === "bedrock" ||
    kind === "lava" ||
    kind === "stone" ||
    kind === "core"
  );
}

/**
 * Kinds a drill can remove (specs/world.md). Everything solid EXCEPT bedrock, lava, and
 * unbreakable STONE — the stone is the in-field obstacle the player must route around, no
 * drill breaks it (specs/character.md, specs/world.md).
 */
export function isMinableKind(kind: Tile["kind"]): boolean {
  return kind === "rock" || kind === "ore" || kind === "material" || kind === "gas" || kind === "core";
}

// ---------------------------------------------------------------------------
// Ore placement — constant density, depth-curve type (specs/mining.md, specs/world.md)
// ---------------------------------------------------------------------------
//
// Ore is placed in TWO stages so that the SHARE of tiles holding ore stays roughly constant at
// every depth while WHICH ore they hold shifts smoothly with depth:
//   1. Is this cell ore at all?  ONE constant roll at ORE_DENSITY (constants.ts), the same in
//      every band — so ore density never spikes in one stratum.
//   2. If so, WHICH ore?  A weighted roll over every ore's frequency AT THIS ROW, from its
//      triangular depth curve (constants.ts oreWeightAtRow). The curves are staggered and
//      OVERLAP, so 4–5 ores are available in any band and the distribution shifts within a band
//      (the bottom of a stratum rolls a different mix than its top). Gems are ordinary entries
//      in this roll with a tiny curve peak, so they are genuinely rare AND covered by the single
//      density above — no separate gem roll, no density bump.
// `oreTypeDistForRow` builds stage 2's (ores, weights) once per row (below).

/** Gas-pocket density per band (0 where the band has no gas — specs/hazards.md). */
const GAS_DENSITY: Record<Band, number> = { topsoil: 0, rockbed: 0.05, deepstone: 0.08, coreshell: 0.12 };
/** Lava density per band (denser in the coreshell — specs/hazards.md). */
const LAVA_DENSITY: Record<Band, number> = { topsoil: 0, rockbed: 0, deepstone: 0.1, coreshell: 0.2 };
/**
 * Unbreakable-stone density per band — scattered obstacles that DENSIFY with depth so the
 * deep bands are more of a maze (specs/world.md). None in the topsoil (the first stratum
 * stays clean, easy dirt); from the rockbed down. Kept modest, and never allowed to seal a
 * route: the connectivity repair below carves stone (like lava) off any path it would block.
 */
const STONE_DENSITY: Record<Band, number> = { topsoil: 0, rockbed: 0.05, deepstone: 0.07, coreshell: 0.09 };

/**
 * Stage 2 of ore placement (specs/mining.md): the ore-TYPE distribution at a given row. Sums
 * every ore's triangular depth curve (constants.ts oreWeightAtRow) and returns those with a
 * non-zero frequency here, paired with their weights, for a single weighted roll. Because the
 * curves overlap and are staggered, this yields 4–5 candidate ores in any band, with the mix
 * (and the rare gems folded in) shifting smoothly as the row deepens. Every minable row below
 * ORE_FREE_TOP_ROWS has at least one candidate, so an ore-cell always resolves to a type.
 */
function oreTypeDistForRow(row: number): { ores: Ore[]; weights: number[] } {
  const ores: Ore[] = [];
  const weights: number[] = [];
  for (const o of Object.keys(ORES) as Ore[]) {
    // Evaluate the depth-frequency curve in BASE-row space so the ore mix at a given FRACTION
    // of the descent is the same at every world size (specs/mining.md, specs/world.md).
    const w = oreWeightAtRow(ORES[o], toBaseRow(row));
    if (w > 0) {
      ores.push(o);
      weights.push(w);
    }
  }
  return { ores, weights };
}

// ---------------------------------------------------------------------------
// The Core chamber pocket (specs/world.md — row 500)
// ---------------------------------------------------------------------------

/** The Core tile column at the bottom pocket (roughly centered in the 32-col world). */
export const CORE_COL = 15;
/** Columns of the open Core-chamber pocket (drill down into these from row 499). */
const CORE_POCKET_COLS = [13, 14, 15, 16, 17, 18];

// ---------------------------------------------------------------------------
// A located material / core node the scanner and world queries use
// ---------------------------------------------------------------------------

export interface MaterialNode {
  material: Material;
  col: number;
  row: number;
  collected: boolean;
}

export interface World {
  /** grid[row][col]. */
  grid: Tile[][];
  /** Every buried material node (Resonite / Cryenite) — the scanner targets these. */
  nodes: MaterialNode[];
  /** The surface column the miner spawns above. */
  spawnCol: number;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function makeTile(kind: Tile["kind"], band: Band): Tile {
  return { kind, band };
}

/** Generate a fresh mine from a seed (specs/world.md). */
export function generateWorld(seed: number): World {
  const rng = new Rng(seed);
  const grid: Tile[][] = [];

  for (let row = 0; row < WORLD.rows; row++) {
    const band = bandForRow(row);
    const line: Tile[] = [];
    for (let col = 0; col < WORLD_COLS; col++) {
      if (col === 0 || col === WORLD_COLS - 1) {
        line.push(makeTile("bedrock", band));
      } else if (row === SURFACE_ROW) {
        // The open surface strip — the miner walks on top of row 1 (specs/world.md).
        line.push(makeTile("tunnel", "topsoil"));
      } else if (row === WORLD.coreRow) {
        // The Core chamber: a bedrock-walled pocket around the glowing Core.
        if (col === CORE_COL) line.push(makeTile("core", "coreshell"));
        else if (CORE_POCKET_COLS.includes(col)) line.push(makeTile("tunnel", "coreshell"));
        else line.push(makeTile("bedrock", "coreshell"));
      } else {
        line.push(makeTile("rock", band));
      }
    }
    grid.push(line);
  }

  // Scatter ore, gas, and lava through every minable row (1..coreRow-1).
  for (let row = WORLD.bands.topsoil.min; row <= WORLD.bands.coreshell.max; row++) {
    const band = bandForRow(row);
    // Ore never spawns in the first three dirt rows just below the surface (specs/world.md).
    const oreAllowed = row > ORE_FREE_TOP_ROWS;
    // This row's ore TYPE distribution, built once from the depth curves (specs/mining.md):
    // every ore whose triangular curve is non-zero here, with its frequency as the weight.
    const dist = oreAllowed ? oreTypeDistForRow(row) : null;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col++) {
      const tile = grid[row]![col]!;
      if (tile.kind !== "rock") continue;
      // Unbreakable stone first (an impassable obstacle), then lava (not minable), then gas,
      // then ore — mutually exclusive per cell. Ore is one CONSTANT-density roll (stage 1);
      // its TYPE (stage 2, including the rare gems) comes from this row's depth-curve
      // distribution. Connectivity is guaranteed below.
      if (STONE_DENSITY[band] > 0 && rng.chance(STONE_DENSITY[band])) {
        tile.kind = "stone";
      } else if (LAVA_DENSITY[band] > 0 && rng.chance(LAVA_DENSITY[band])) {
        tile.kind = "lava";
      } else if (GAS_DENSITY[band] > 0 && rng.chance(GAS_DENSITY[band])) {
        tile.kind = "gas";
      } else if (dist && dist.ores.length > 0 && rng.chance(ORE_DENSITY)) {
        tile.kind = "ore";
        tile.ore = rng.weighted(dist.ores, dist.weights);
      }
    }
  }

  // Never let a row be sealed by lava/stone (that would wall off the descent). Keep a
  // healthy fraction of each deep row diggable (specs/world.md — a determined driller
  // always gets through); convert stray lava/stone back to rock until it is.
  for (let row = WORLD.bands.deepstone.min; row <= WORLD.bands.coreshell.max; row++) {
    const band = bandForRow(row);
    let minable = 0;
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col++) {
      if (isMinableKind(grid[row]![col]!.kind)) minable++;
    }
    const cols = PLAYABLE_COL_MAX - PLAYABLE_COL_MIN + 1;
    let guard = 0;
    while (minable < Math.ceil(cols * 0.45) && guard++ < 400) {
      const col = rng.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
      const k = grid[row]![col]!.kind;
      if (k === "lava" || k === "stone") {
        grid[row]![col] = makeTile("rock", band);
        minable++;
      }
    }
  }

  // Buried material nodes — GUARANTEED present at random positions (specs/world.md).
  const nodes: MaterialNode[] = [];
  placeMaterialNodes(grid, rng, nodes, "resonite", WORLD.bands.rockbed.min, WORLD.bands.rockbed.max);
  placeMaterialNodes(grid, rng, nodes, "cryenite", WORLD.bands.deepstone.min, WORLD.bands.deepstone.max);

  const spawnCol = 15;

  // Guarantee winnability: every material node and the Core must be reachable from the
  // surface through non-lava rock. Carve any lava that would seal a required route.
  const targets: { col: number; row: number }[] = nodes.map((n) => ({ col: n.col, row: n.row }));
  targets.push({ col: CORE_COL, row: WORLD.coreRow });
  repairConnectivity(grid, spawnCol, targets);

  return { grid, nodes, spawnCol };
}

function placeMaterialNodes(
  grid: Tile[][],
  rng: Rng,
  nodes: MaterialNode[],
  material: Material,
  rowMin: number,
  rowMax: number,
): void {
  const count = MATERIAL_NODES_PER_BAND; // exactly one — the scanner is what makes it findable
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < 2000) {
    guard++;
    const row = rng.int(rowMin, rowMax);
    const col = rng.int(PLAYABLE_COL_MIN, PLAYABLE_COL_MAX);
    const tile = grid[row]![col]!;
    if (tile.kind !== "rock" && tile.kind !== "ore") continue;
    // Do not stack two nodes on the same cell.
    if (nodes.some((n) => n.col === col && n.row === row)) continue;
    const band = tile.band;
    grid[row]![col] = { kind: "material", band, material };
    nodes.push({ material, col, row, collected: false });
    placed++;
    // Clear any lava hugging the node so it is never sealed (belt-and-braces; the
    // connectivity pass below is the real guarantee).
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < PLAYABLE_COL_MIN || nc > PLAYABLE_COL_MAX || nr < 1 || nr > WORLD.bands.coreshell.max) continue;
      const nk = grid[nr]![nc]!.kind;
      if (nk === "lava" || nk === "stone") grid[nr]![nc] = makeTile("rock", bandForRow(nr));
    }
  }
}

/**
 * Flood the reachable region from the surface over non-lava, non-bedrock cells; for any
 * target not reached, carve the lava along a shortest path back to the reachable region.
 * Guarantees every material node and the Core is reachable (specs/world.md).
 */
function repairConnectivity(grid: Tile[][], spawnCol: number, targets: { col: number; row: number }[]): void {
  const key = (c: number, r: number): number => r * WORLD_COLS + c;
  const passable = (c: number, r: number): boolean => {
    if (c < 0 || c >= WORLD_COLS || r < 0 || r >= WORLD.rows) return false;
    const k = grid[r]![c]!.kind;
    // The miner can dig through anything but bedrock, lava, and unbreakable stone; a target
    // reachable only past those must be re-carved (below).
    return k !== "bedrock" && k !== "lava" && k !== "stone";
  };

  const floodFrom = (): Set<number> => {
    const seen = new Set<number>();
    const stack: [number, number][] = [[spawnCol, SURFACE_ROW]];
    seen.add(key(spawnCol, SURFACE_ROW));
    while (stack.length) {
      const [c, r] = stack.pop()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (!passable(nc, nr)) continue;
        const nk = key(nc, nr);
        if (seen.has(nk)) continue;
        seen.add(nk);
        stack.push([nc, nr]);
      }
    }
    return seen;
  };

  for (let iter = 0; iter < 8; iter++) {
    const reachable = floodFrom();
    const missing = targets.filter((t) => !reachable.has(key(t.col, t.row)));
    if (missing.length === 0) break;
    // BFS from the first missing target through anything but bedrock (lava allowed) until
    // it meets the reachable region; convert the lava on that path to rock.
    const target = missing[0]!;
    const prev = new Map<number, number>();
    const q: [number, number][] = [[target.col, target.row]];
    const start = key(target.col, target.row);
    prev.set(start, -1);
    let hit = -1;
    while (q.length) {
      const [c, r] = q.shift()!;
      const cur = key(c, r);
      if (reachable.has(cur)) {
        hit = cur;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nc >= WORLD_COLS || nr < 0 || nr >= WORLD.rows) continue;
        if (grid[nr]![nc]!.kind === "bedrock") continue;
        const nk = key(nc, nr);
        if (prev.has(nk)) continue;
        prev.set(nk, cur);
        q.push([nc, nr]);
      }
    }
    if (hit < 0) break; // should not happen; bedrock only borders
    // Walk the path back, clearing any lava or stone that blocked the route to rock.
    let node = prev.get(hit) ?? -1;
    while (node !== -1 && node !== start) {
      const c = node % WORLD_COLS;
      const r = Math.floor(node / WORLD_COLS);
      const k = grid[r]![c]!.kind;
      if (k === "lava" || k === "stone") grid[r]![c] = makeTile("rock", bandForRow(r));
      node = prev.get(node) ?? -1;
    }
  }
}
