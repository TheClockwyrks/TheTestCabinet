// Junction — power & water: one mechanism, two carriers (specs/utilities.md, DESIGN §4).
//
// Power is generated at a plant and carried on wires; water is drawn at a source and carried
// on pipes. Both are the same shape: supply propagates from a source through its connected
// carrier network and reaches the developed tiles ADJACENT to that network. Each tick this
// pass marks `powered` / `watered`, resolves OVER-DRAW deterministically — the network can't
// serve past its capacity, so the farthest-from-source tiles are starved first (a visible
// blackout at the fringe) — and reports each utility's city-wide supply-vs-demand to the HUD.
// It reads the `powerNet` / `waterNet` components that `graph.rebuildNetworks` labelled on
// the last edit, so a tick is a cheap sweep.

import { NET_PIPE, NET_WIRE, TILE_COUNT, UTIL_DEMAND } from "./constants";
import { NEIGHBORS, World, colOf, idx, inBounds, rowOf } from "./world";
import type { Game } from "./sim";

// Resolve both utilities for the tick and write the balances into `stats`.
export function stepUtilities(game: Game): void {
  const w = game.world;
  w.powered.fill(0);
  w.watered.fill(0);
  const power = serveNetwork(w, NET_WIRE, w.powerNet, "plant", w.powered);
  const water = serveNetwork(w, NET_PIPE, w.waterNet, "source", w.watered);
  game.stats.power = { supply: power.supply, demand: power.demand };
  game.stats.water = { supply: water.supply, demand: water.demand };
}

interface DemandTile {
  tile: number;
  comp: number;
  dist: number;
  units: number;
}

// Serve one utility network; sets `served[tile]=1` for every reached-and-fed tile and returns
// the city-wide supply/demand totals for the HUD.
function serveNetwork(w: World, bit: number, netArr: Int16Array, kind: "plant" | "source", served: Uint8Array): { supply: number; demand: number } {
  let supply = 0;
  let demand = 0;

  // 1. Component capacities from the sources feeding them, and total supply.
  const compCap = new Map<number, number>();
  const compUsed = new Map<number, number>();
  const seeds: number[] = []; // carrier tiles adjacent to a source (BFS roots)
  for (const src of w.sources) {
    src.supplied = 0;
    if (src.kind !== kind) continue;
    supply += src.capacity;
    let firstComp = -1;
    for (const c of adjacentCarriers(w, src.col, src.row, bit, netArr)) {
      const comp = netArr[c]!;
      compCap.set(comp, (compCap.get(comp) ?? 0) + src.capacity);
      if (firstComp < 0) firstComp = comp;
      seeds.push(c);
    }
    src.net = firstComp;
  }

  // 2. Distance from a source over the carrier network (farthest-first over-draw order).
  const dist = new Int32Array(TILE_COUNT).fill(-1);
  let head = 0;
  const queue: number[] = [];
  for (const s of seeds) {
    if (dist[s]! < 0) {
      dist[s] = 0;
      queue.push(s);
    }
  }
  while (head < queue.length) {
    const cur = queue[head++]!;
    const col = colOf(cur);
    const row = rowOf(cur);
    const nd = dist[cur]! + 1;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const j = idx(nc, nr);
      if ((w.net[j]! & bit) !== 0 && dist[j]! < 0) {
        dist[j] = nd;
        queue.push(j);
      }
    }
  }

  // 3. The zoned tiles that draw on the network: any tile adjacent to a fed carrier, keyed to
  //    the nearest such carrier's component and distance. A developed tile draws its tier's
  //    demand; an EMPTY zoned lot draws nothing but must still read as reachable so it can
  //    develop (service is a precondition — specs/map.md), so it is a zero-demand candidate.
  const wants: DemandTile[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if (w.zone[i]! === 0) continue;
    const units = w.tier[i]! > 0 ? UTIL_DEMAND[w.zoneAt(i)!]![w.tier[i]!]! : 0;
    demand += units;
    let bestComp = -1;
    let bestDist = Infinity;
    const col = colOf(i);
    const row = rowOf(i);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const j = idx(nc, nr);
      if ((w.net[j]! & bit) === 0 || dist[j]! < 0) continue;
      if (dist[j]! < bestDist) {
        bestDist = dist[j]!;
        bestComp = netArr[j]!;
      }
    }
    if (bestComp >= 0) wants.push({ tile: i, comp: bestComp, dist: bestDist, units });
  }

  // 4. Allocate each component's capacity nearest-first; tiles past capacity go without
  //    (the farthest starve — a visible fringe blackout).
  wants.sort((a, b) => a.comp - b.comp || a.dist - b.dist || a.tile - b.tile);
  for (const dt of wants) {
    const cap = compCap.get(dt.comp) ?? 0;
    const used = compUsed.get(dt.comp) ?? 0;
    if (used + dt.units <= cap) {
      served[dt.tile] = 1;
      compUsed.set(dt.comp, used + dt.units);
    }
  }

  // Report how much each source's component actually drew (for the over-draw HUD read).
  for (const src of w.sources) {
    if (src.kind !== kind) continue;
    src.supplied = Math.min(src.capacity, compUsed.get(src.net) ?? 0);
  }

  return { supply, demand };
}

// Carrier tiles (of `bit`) edge-adjacent to a source's 2×2 footprint.
function adjacentCarriers(w: World, col: number, row: number, bit: number, netArr: Int16Array): number[] {
  const out: number[] = [];
  for (let r = row; r <= row + 1; r++) {
    for (let c = col; c <= col + 1; c++) {
      for (const [dc, dr] of NEIGHBORS) {
        const nc = c + dc;
        const nr = r + dr;
        if (!inBounds(nc, nr)) continue;
        const j = idx(nc, nr);
        // Skip carriers inside the footprint itself; only outward-facing carriers feed out.
        if (nc >= col && nc <= col + 1 && nr >= row && nr <= row + 1) continue;
        if ((w.net[j]! & bit) !== 0 && netArr[j]! >= 0) out.push(j);
      }
    }
  }
  return out;
}
