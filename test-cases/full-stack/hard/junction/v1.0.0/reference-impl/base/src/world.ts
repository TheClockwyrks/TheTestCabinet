// Junction — the tile grid: the struct-of-arrays world the sim sweeps every tick
// (specs/map.md, DESIGN §2.2). Dense typed arrays indexed by `idx = row*MAP_COLS + col`
// hold the per-tile fields (terrain, zone, carriers, tier, the diffusing pollution/land
// fields, the served/access flags, the live traffic load), plus a list of placed 2×2
// sources. It also generates the starter valley (a winding river, a couple of hills) and
// carries the small helpers — index math, buildability, the net bitmask — every later
// module keys off. This file owns no rendering and no economy; just the land and its shape.

import {
  MAP_COLS,
  MAP_ROWS,
  NET_PIPE,
  NET_RAIL,
  NET_ROAD,
  NET_STATION,
  NET_WIRE,
  TERRAIN_ORDER,
  TILE_COUNT,
  ZONE_ORDER,
} from "./constants";
import { Rng } from "./rng";
import type { Source, Terrain, ZoneKind } from "./types";

// Terrain / zone integer encodings (constants.ts documents the layout).
export const T_EARTH = TERRAIN_ORDER.indexOf("earth");
export const T_GRASS = TERRAIN_ORDER.indexOf("grass");
export const T_WATER = TERRAIN_ORDER.indexOf("water");
export const T_HILL = TERRAIN_ORDER.indexOf("hill");

// Any carrier bit occupies the tile (road/rail/wire/pipe/station).
export const NET_CARRIER = NET_ROAD | NET_RAIL | NET_WIRE | NET_PIPE | NET_STATION;

export function idx(col: number, row: number): number {
  return row * MAP_COLS + col;
}
export function colOf(i: number): number {
  return i % MAP_COLS;
}
export function rowOf(i: number): number {
  return (i / MAP_COLS) | 0;
}
export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < MAP_COLS && row >= 0 && row < MAP_ROWS;
}

export class World {
  readonly cols = MAP_COLS;
  readonly rows = MAP_ROWS;

  // Per-tile fields (DESIGN §2.2).
  terrain = new Uint8Array(TILE_COUNT);
  zone = new Uint8Array(TILE_COUNT); // 0 = none, else ZONE_ORDER index + 1
  net = new Uint8Array(TILE_COUNT); // carrier bitmask (NET_*)
  tier = new Uint8Array(TILE_COUNT); // 0 = empty lot, 1..3 density tier
  build = new Float32Array(TILE_COUNT); // 0..1 progress toward next tier
  decay = new Float32Array(TILE_COUNT); // 0..1 dilapidation toward abandonment
  pollution = new Float32Array(TILE_COUNT); // 0..100 diffusing field
  land = new Float32Array(TILE_COUNT); // 0..1 computed land value
  powered = new Uint8Array(TILE_COUNT); // served by a power net this tick
  watered = new Uint8Array(TILE_COUNT); // served by a water net this tick
  access = new Uint8Array(TILE_COUNT); // within WALK_TILES of the road network
  roadNet = new Int16Array(TILE_COUNT); // connected-component id per carrier (-1 none)
  railNet = new Int16Array(TILE_COUNT);
  powerNet = new Int16Array(TILE_COUNT);
  waterNet = new Int16Array(TILE_COUNT);
  load = new Float32Array(TILE_COUNT); // trips assigned to this link this tick
  cap = new Float32Array(TILE_COUNT); // link capacity (derived from net kind)

  // Sim scratch / derived static fields (not part of the render contract, but owned here so
  // the tick passes stay cheap array sweeps).
  prevLoad = new Float32Array(TILE_COUNT); // last tick's load — congestion weight source
  pollScratch = new Float32Array(TILE_COUNT); // diffusion double-buffer
  waterDist = new Float32Array(TILE_COUNT); // tiles to nearest water (static, amenity radius)
  stationBonus = new Float32Array(TILE_COUNT); // land bonus stamped near stations (on edit)
  accessNode = new Int32Array(TILE_COUNT); // nearest road/station tile within WALK_TILES (-1)

  sources: Source[] = [];
  nextSourceId = 1;

  constructor() {
    this.roadNet.fill(-1);
    this.railNet.fill(-1);
    this.powerNet.fill(-1);
    this.waterNet.fill(-1);
    this.accessNode.fill(-1);
  }

  terrainAt(i: number): Terrain {
    return TERRAIN_ORDER[this.terrain[i]!]!;
  }
  zoneAt(i: number): ZoneKind | null {
    const z = this.zone[i]!;
    return z === 0 ? null : ZONE_ORDER[z - 1]!;
  }
  setZone(i: number, kind: ZoneKind | null): void {
    this.zone[i] = kind === null ? 0 : ZONE_ORDER.indexOf(kind) + 1;
  }

  hasNet(i: number, bit: number): boolean {
    return (this.net[i]! & bit) !== 0;
  }
  setNet(i: number, bit: number): void {
    this.net[i]! |= bit;
  }
  clearNet(i: number, bit: number): void {
    this.net[i]! &= ~bit;
  }

  developedAt(i: number): boolean {
    return this.zone[i]! !== 0 && this.tier[i]! > 0;
  }
}

// Bare land the city can zone/build on (specs/map.md): earth or grass, never water/hill.
export function buildable(w: World, i: number): boolean {
  const t = w.terrain[i]!;
  return t === T_EARTH || t === T_GRASS;
}
// A carrier may cross this tile only as a span (bridge/tunnel): water or hill.
export function needsSpan(w: World, i: number): boolean {
  const t = w.terrain[i]!;
  return t === T_WATER || t === T_HILL;
}

// ---- The starter valley (specs/mode.md) ----------------------------------------
// A mostly-flat buildable valley: broad earth/grass, a winding river across the upper band
// (a water source + amenity) and a couple of low hills that fragment the cheap land. The
// pre-placed road stub is laid by `sim.newCity` from the mode config (mode.ts owns the
// geometry); this generator produces only the terrain and the static water-distance field.
export function generateValley(seed: number): World {
  const w = new World();
  const rng = new Rng(seed >>> 0);

  // Base ground: mostly earth with scattered grass patches (both buildable; cosmetic).
  for (let i = 0; i < TILE_COUNT; i++) {
    w.terrain[i] = rng.next() < 0.28 ? T_GRASS : T_EARTH;
  }

  // A winding river across the upper third of the map (rows ~10..26).
  for (let col = 0; col < MAP_COLS; col++) {
    const centre = 18 + Math.round(7 * Math.sin(col / 13) + 2.5 * Math.sin(col / 4));
    for (let d = -1; d <= 1; d++) {
      const row = centre + d;
      if (inBounds(col, row)) w.terrain[idx(col, row)] = T_WATER;
    }
  }

  // Two low hills that break up the open ground (kept clear of the river band and stub).
  stampHill(w, 22, 52, 5, rng);
  stampHill(w, 74, 48, 4, rng);

  computeWaterDist(w);
  return w;
}

function stampHill(w: World, cc: number, cr: number, radius: number, rng: Rng): void {
  for (let row = cr - radius; row <= cr + radius; row++) {
    for (let col = cc - radius; col <= cc + radius; col++) {
      if (!inBounds(col, row)) continue;
      const i = idx(col, row);
      if (w.terrain[i] === T_WATER) continue;
      const d = Math.hypot(col - cc, row - cr);
      if (d <= radius - 0.5 * rng.next()) w.terrain[i] = T_HILL;
    }
  }
}

// BFS distance (in tiles) from every tile to the nearest water tile — static, so the land
// amenity bonus (specs/economy.md) is a cheap lookup each tick rather than a search.
export function computeWaterDist(w: World): void {
  const dist = w.waterDist;
  dist.fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if (w.terrain[i] === T_WATER) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const col = colOf(i);
    const row = rowOf(i);
    const d = dist[i]! + 1;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const j = idx(nc, nr);
      if (dist[j]! > d) {
        dist[j] = d;
        queue.push(j);
      }
    }
  }
}

// 4-neighbour offsets, shared by the tile sweeps.
export const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
