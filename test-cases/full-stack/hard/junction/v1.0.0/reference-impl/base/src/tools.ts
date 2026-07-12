// Junction — the build tools: legality, cost, and placement (specs/controls.md, DESIGN §4).
//
// One active tool paints the map: zones as a filled rectangle, roads/rail/wire/pipe as a
// dragged L-run, stations/plants/sources as single stamps. This module owns the LEGALITY
// predicate (with a spoken refusal reason for the illegal-placement cursor), the span-aware
// CAPITAL COST, and the mutation that writes the tile arrays / source list and charges the
// treasury. It does not run the sim or touch the canvas; `sim.ts` calls it, then re-labels
// the networks. Refusals the spec names: zoning water/hill or a developed tile, a station off
// the rail or off the road, a source not beside water, an unaffordable build, and a carrier
// laid over water/hill only as a priced-up span.

import {
  BULLDOZE_REFUND,
  COST,
  MAP_COLS,
  MAP_ROWS,
  NET_PIPE,
  NET_RAIL,
  NET_ROAD,
  NET_SPAN,
  NET_STATION,
  NET_WIRE,
  POWER_PLANT_CAP,
  SPAN_COST_EXTRA,
  TOOL_ZONE,
  WATER_SOURCE_CAP,
} from "./constants";
import { NEIGHBORS, World, buildable, colOf, idx, inBounds, needsSpan, rowOf } from "./world";
import type { Source, Tool } from "./types";
import type { Game } from "./sim";

export interface PlaceCheck {
  ok: boolean;
  reason?: string; // shown by the illegal-placement cursor when ok=false
}

export interface ApplyResult {
  placed: number; // tiles/structures actually placed
  spent: number; // total capital charged
  refused?: string; // first refusal reason (unaffordable / illegal), for HUD feedback
}

const CARRIER_BITS = NET_ROAD | NET_RAIL | NET_WIRE | NET_PIPE | NET_STATION;

// ---- The tile list a drag paints (specs/controls.md) ---------------------------
// Zones and bulldoze fill the rectangle; linear carriers lay an L-run (horizontal then
// vertical); single-stamp tools ignore the end point.
export function tilesForDrag(tool: Tool, c0: number, r0: number, c1: number, r1: number): number[] {
  if (tool === "plant" || tool === "source" || tool === "station") return inBounds(c0, r0) ? [idx(c0, r0)] : [];
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (c: number, r: number): void => {
    if (!inBounds(c, r)) return;
    const i = idx(c, r);
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  if (TOOL_ZONE[tool] || tool === "bulldoze") {
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    const loc = Math.min(c0, c1);
    const hic = Math.max(c0, c1);
    for (let r = lo; r <= hi; r++) for (let c = loc; c <= hic; c++) push(c, r);
    return out;
  }
  // Carrier run: along row r0 to c1, then along column c1 to r1.
  const stepC = c1 >= c0 ? 1 : -1;
  for (let c = c0; c !== c1 + stepC; c += stepC) push(c, r0);
  const stepR = r1 >= r0 ? 1 : -1;
  for (let r = r0; r !== r1 + stepR; r += stepR) push(c1, r);
  return out;
}

// ---- Legality (specs/controls.md) ----------------------------------------------
export function canPlace(w: World, tool: Tool, i: number): PlaceCheck {
  const zoneKind = TOOL_ZONE[tool];
  if (zoneKind) {
    if (!buildable(w, i)) return { ok: false, reason: "CAN'T ZONE WATER/HILL" };
    if (w.net[i]! & CARRIER_BITS) return { ok: false, reason: "TILE OCCUPIED" };
    if (sourceCovering(w, i)) return { ok: false, reason: "TILE OCCUPIED" };
    if (w.tier[i]! > 0) return { ok: false, reason: "BULLDOZE TO RE-ZONE" };
    return { ok: true };
  }
  switch (tool) {
    case "road":
      return carrierCheck(w, i, NET_RAIL, "ROAD CAN'T CROSS RAIL");
    case "rail":
      return carrierCheck(w, i, NET_ROAD, "RAIL CAN'T CROSS ROAD");
    case "wire":
    case "pipe":
      // Utilities may run under roads/zones; only water/hill needs a span.
      if (!buildable(w, i) && !needsSpan(w, i)) return { ok: false };
      if (sourceCovering(w, i)) return { ok: false, reason: "TILE OCCUPIED" };
      return { ok: true };
    case "station":
      if ((w.net[i]! & NET_RAIL) === 0) return { ok: false, reason: "STATION NEEDS RAIL" };
      if (!adjacentToRoad(w, i)) return { ok: false, reason: "STATION NEEDS ROAD" };
      return { ok: true };
    case "plant":
      return footprintCheck(w, i, false);
    case "source":
      return footprintCheck(w, i, true);
    default:
      return { ok: false };
  }
}

function carrierCheck(w: World, i: number, forbid: number, forbidReason: string): PlaceCheck {
  if (w.net[i]! & forbid) return { ok: false, reason: forbidReason };
  if (sourceCovering(w, i)) return { ok: false, reason: "TILE OCCUPIED" };
  if (buildable(w, i)) return { ok: true };
  if (needsSpan(w, i)) return { ok: true }; // priced up as a span
  return { ok: false };
}

// A 2×2 source footprint anchored at (i): every tile buildable and clear; a water source
// additionally must sit beside a water tile.
function footprintCheck(w: World, i: number, wantsWater: boolean): PlaceCheck {
  const col = colOf(i);
  const row = rowOf(i);
  if (col + 1 >= MAP_COLS || row + 1 >= MAP_ROWS) return { ok: false, reason: "OUT OF BOUNDS" };
  for (let r = row; r <= row + 1; r++) {
    for (let c = col; c <= col + 1; c++) {
      const j = idx(c, r);
      if (!buildable(w, j)) return { ok: false, reason: "NEEDS FLAT LAND" };
      if (w.net[j]! & CARRIER_BITS) return { ok: false, reason: "TILE OCCUPIED" };
      if (sourceCovering(w, j)) return { ok: false, reason: "TILE OCCUPIED" };
      if (w.tier[j]! > 0) return { ok: false, reason: "BULLDOZE FIRST" };
    }
  }
  if (wantsWater && !footprintBesideWater(w, col, row)) return { ok: false, reason: "SOURCE NEEDS WATER" };
  return { ok: true };
}

function footprintBesideWater(w: World, col: number, row: number): boolean {
  for (let r = row - 1; r <= row + 2; r++) {
    for (let c = col - 1; c <= col + 2; c++) {
      if (!inBounds(c, r)) continue;
      if (c >= col && c <= col + 1 && r >= row && r <= row + 1) continue;
      if (needsSpanWater(w, idx(c, r))) return true;
    }
  }
  return false;
}

function adjacentToRoad(w: World, i: number): boolean {
  const col = colOf(i);
  const row = rowOf(i);
  for (const [dc, dr] of NEIGHBORS) {
    const nc = col + dc;
    const nr = row + dr;
    if (inBounds(nc, nr) && w.net[idx(nc, nr)]! & (NET_ROAD | NET_STATION)) return true;
  }
  return false;
}

// ---- Cost (span-aware) ---------------------------------------------------------
export function capitalCostAt(w: World, tool: Tool, i: number): number {
  const base = COST[tool];
  if ((tool === "road" || tool === "rail" || tool === "wire" || tool === "pipe") && needsSpan(w, i)) {
    return base + SPAN_COST_EXTRA;
  }
  return base;
}

export function dragCost(w: World, tool: Tool, tiles: number[]): number {
  let total = 0;
  for (const i of tiles) if (canPlace(w, tool, i).ok) total += capitalCostAt(w, tool, i);
  return total;
}

// ---- Apply (charges the treasury, mutates the world) ---------------------------
export function applyTool(game: Game, tool: Tool, tiles: number[]): ApplyResult {
  if (tool === "bulldoze") return { placed: bulldozeTiles(game, tiles).count, spent: 0 };
  const w = game.world;
  let placed = 0;
  let spent = 0;
  let refused: string | undefined;
  for (const i of tiles) {
    const chk = canPlace(w, tool, i);
    if (!chk.ok) {
      refused ??= chk.reason;
      continue;
    }
    const cost = capitalCostAt(w, tool, i);
    if (game.budget.treasury < cost) {
      refused ??= "NOT ENOUGH FUNDS";
      break; // a drag run stops at the tile the player can no longer afford
    }
    placeOne(game, tool, i);
    game.budget.treasury -= cost;
    spent += cost;
    placed++;
  }
  if (placed > 0) {
    game.markNetworksDirty();
    game.sndQueue.push("build");
  }
  return { placed, spent, refused };
}

function placeOne(game: Game, tool: Tool, i: number): void {
  const w = game.world;
  const zoneKind = TOOL_ZONE[tool];
  if (zoneKind) {
    w.setZone(i, zoneKind);
    return;
  }
  const span = needsSpan(w, i);
  switch (tool) {
    case "road":
      w.setNet(i, NET_ROAD);
      if (span) w.setNet(i, NET_SPAN);
      break;
    case "rail":
      w.setNet(i, NET_RAIL);
      if (span) w.setNet(i, NET_SPAN);
      break;
    case "wire":
      w.setNet(i, NET_WIRE);
      if (span) w.setNet(i, NET_SPAN);
      break;
    case "pipe":
      w.setNet(i, NET_PIPE);
      if (span) w.setNet(i, NET_SPAN);
      break;
    case "station":
      w.setNet(i, NET_STATION);
      break;
    case "plant":
      addSource(w, "plant", i, POWER_PLANT_CAP);
      break;
    case "source":
      addSource(w, "source", i, WATER_SOURCE_CAP);
      break;
    default:
      break;
  }
}

function addSource(w: World, kind: "plant" | "source", i: number, capacity: number): void {
  const src: Source = { id: w.nextSourceId++, kind, col: colOf(i), row: rowOf(i), capacity, supplied: 0, net: -1 };
  w.sources.push(src);
}

// ---- Bulldoze (refund + clear) -------------------------------------------------
export function bulldozeTiles(game: Game, tiles: number[]): { count: number; delta: number } {
  const w = game.world;
  let count = 0;
  let delta = 0;
  for (const i of tiles) {
    const src = sourceCovering(w, i);
    if (src) {
      delta += BULLDOZE_REFUND * COST[src.kind] - COST.bulldoze;
      w.sources = w.sources.filter((s) => s.id !== src.id);
      count++;
      continue;
    }
    const cap = existingCapital(w, i);
    if (cap <= 0 && w.zone[i]! === 0) continue; // nothing to raze here
    delta += BULLDOZE_REFUND * cap - COST.bulldoze;
    w.zone[i] = 0;
    w.net[i] = 0;
    w.tier[i] = 0;
    w.build[i] = 0;
    w.decay[i] = 0;
    count++;
  }
  if (count > 0) {
    game.budget.treasury += delta;
    game.markNetworksDirty();
    game.sndQueue.push("build");
  }
  return { count, delta };
}

// The capital originally sunk into a tile's carriers + zone, for the bulldoze refund.
function existingCapital(w: World, i: number): number {
  const n = w.net[i]!;
  let cap = 0;
  if (w.zone[i]! !== 0) cap += COST.zoneRes;
  if (n & NET_ROAD) cap += COST.road;
  if (n & NET_RAIL) cap += COST.rail;
  if (n & NET_STATION) cap += COST.station;
  if (n & NET_WIRE) cap += COST.wire;
  if (n & NET_PIPE) cap += COST.pipe;
  if (n & NET_SPAN) cap += SPAN_COST_EXTRA;
  return cap;
}

// ---- Shared occupancy helpers --------------------------------------------------
// The source whose 2×2 footprint covers tile i, if any.
export function sourceCovering(w: World, i: number): Source | null {
  const col = colOf(i);
  const row = rowOf(i);
  for (const s of w.sources) {
    if (col >= s.col && col <= s.col + 1 && row >= s.row && row <= s.row + 1) return s;
  }
  return null;
}

// Water terrain test kept local so `world` need not expose the terrain code.
function needsSpanWater(w: World, i: number): boolean {
  return w.terrainAt(i) === "water";
}
