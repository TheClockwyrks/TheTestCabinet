// Junction — the network graph: connected-component labelling per carrier and the weighted
// path search the transit flow rides (specs/transit.md, DESIGN §4).
//
// `rebuildNetworks` re-labels the road / rail / wire / pipe components (a maximal set of
// edge-connected carriers is one network) into the world's `*Net` arrays; it is rebuilt on
// any edit. The transit flow then routes over the road+rail graph with `routeField` — a
// multi-source Dijkstra rooted at the trip destinations, weighted by LIVE per-link travel
// time (a link's weight rises with its congestion), returning a shortest-path tree the
// transit module walks to lay load onto links. `findPath` is the single-pair A* the same
// weights admit, used by the UI/proof to trace one route. Rail steps are cheaper than road
// (RAIL_SPEED_MULT) and stations bridge the two, so through-traffic prefers a parallel rail
// line — the observable payoff the spec asks for.

import { CONGEST_K, NET_PIPE, NET_RAIL, NET_ROAD, NET_STATION, NET_WIRE, RAIL_SPEED_MULT, TILE_COUNT } from "./constants";
import { NEIGHBORS, World, colOf, idx, inBounds, rowOf } from "./world";

const ROAD_STEP = 1; // base travel cost of entering a road tile (tiles)
const RAIL_STEP = 1 / RAIL_SPEED_MULT; // a rail step is cheaper — rail is faster

// A tile participates in the transit graph as a road node, a rail node, or both (a station
// carries the rail line AND connects to the road, so it is the transfer point).
function roadMode(w: World, i: number): boolean {
  return (w.net[i]! & (NET_ROAD | NET_STATION)) !== 0;
}
function railMode(w: World, i: number): boolean {
  return (w.net[i]! & (NET_RAIL | NET_STATION)) !== 0;
}
export function isTransitNode(w: World, i: number): boolean {
  return (w.net[i]! & (NET_ROAD | NET_RAIL | NET_STATION)) !== 0;
}

// Congestion multiplier on a link from its previous-tick load vs capacity (specs/transit.md):
// within capacity flows at full speed (×1); over capacity, travel time climbs linearly.
function congestion(w: World, i: number): number {
  const cap = w.cap[i]!;
  if (cap <= 0) return 1;
  return 1 + CONGEST_K * Math.max(0, w.prevLoad[i]! / cap - 1);
}

// The cost of stepping from node `from` into neighbour `to` — the cheaper of the road step
// and the rail step where both modes are shared, each scaled by `to`'s live congestion.
function stepWeight(w: World, from: number, to: number): number {
  let best = Infinity;
  if (roadMode(w, from) && roadMode(w, to)) best = Math.min(best, ROAD_STEP * congestion(w, to));
  if (railMode(w, from) && railMode(w, to)) best = Math.min(best, RAIL_STEP * congestion(w, to));
  return best;
}

// ---- Connected components per carrier (rebuilt on any edit) ---------------------
export function rebuildNetworks(w: World): void {
  labelComponents(w, NET_ROAD, w.roadNet);
  labelComponents(w, NET_RAIL | NET_STATION, w.railNet);
  labelComponents(w, NET_WIRE, w.powerNet);
  labelComponents(w, NET_PIPE, w.waterNet);
}

function labelComponents(w: World, mask: number, out: Int16Array): void {
  out.fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((w.net[i]! & mask) === 0 || out[i]! >= 0) continue;
    out[i] = id;
    stack.length = 0;
    stack.push(i);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const col = colOf(cur);
      const row = rowOf(cur);
      for (const [dc, dr] of NEIGHBORS) {
        const nc = col + dc;
        const nr = row + dr;
        if (!inBounds(nc, nr)) continue;
        const j = idx(nc, nr);
        if ((w.net[j]! & mask) !== 0 && out[j]! < 0) {
          out[j] = id;
          stack.push(j);
        }
      }
    }
    id++;
  }
}

// ---- A binary min-heap keyed by tentative distance -----------------------------
class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  push(node: number, key: number): void {
    this.nodes.push(node);
    this.keys.push(key);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.nodes[0]!;
    const lastN = this.nodes.pop()!;
    const lastK = this.keys.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastN;
      this.keys[0] = lastK;
      let i = 0;
      const n = this.nodes.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.keys[l]! < this.keys[m]!) m = l;
        if (r < n && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const tn = this.nodes[a]!;
    this.nodes[a] = this.nodes[b]!;
    this.nodes[b] = tn;
    const tk = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = tk;
  }
}

// A shortest-path tree over the transit graph, rooted at every source tile (dist 0). For
// each reached node, `parent` points to the neighbour one step CLOSER to a source, so a
// trip origin walks parents to reach the nearest destination, laying load as it goes.
export interface RouteField {
  dist: Float32Array;
  parent: Int32Array;
}

export function routeField(w: World, sources: number[]): RouteField {
  const dist = new Float32Array(TILE_COUNT).fill(Infinity);
  const parent = new Int32Array(TILE_COUNT).fill(-1);
  const done = new Uint8Array(TILE_COUNT);
  const heap = new MinHeap();
  for (const s of sources) {
    if (isTransitNode(w, s) && dist[s]! > 0) {
      dist[s] = 0;
      heap.push(s, 0);
    }
  }
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]!) continue;
    done[u] = 1;
    const col = colOf(u);
    const row = rowOf(u);
    const du = dist[u]!;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const v = idx(nc, nr);
      if (done[v]! || !isTransitNode(w, v)) continue;
      const wgt = stepWeight(w, u, v);
      if (!isFinite(wgt)) continue;
      const nd = du + wgt;
      if (nd < dist[v]!) {
        dist[v] = nd;
        parent[v] = u; // v steps to u to move toward a source
        heap.push(v, nd);
      }
    }
  }
  return { dist, parent };
}

// Single-pair A* over the same weighted graph (specs/transit.md "real path search"). Returns
// the tile-index path a→b inclusive, or null if b is unreachable from a. Used by the UI/proof
// to trace one route; the flow itself uses the multi-source field above.
export function findPath(w: World, a: number, b: number): number[] | null {
  if (!isTransitNode(w, a) || !isTransitNode(w, b)) return null;
  const g = new Float32Array(TILE_COUNT).fill(Infinity);
  const came = new Int32Array(TILE_COUNT).fill(-1);
  const done = new Uint8Array(TILE_COUNT);
  const bc = colOf(b);
  const br = rowOf(b);
  const heuristic = (i: number): number => (Math.abs(colOf(i) - bc) + Math.abs(rowOf(i) - br)) * RAIL_STEP;
  const heap = new MinHeap();
  g[a] = 0;
  heap.push(a, heuristic(a));
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]!) continue;
    if (u === b) break;
    done[u] = 1;
    const col = colOf(u);
    const row = rowOf(u);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const v = idx(nc, nr);
      if (done[v]! || !isTransitNode(w, v)) continue;
      const wgt = stepWeight(w, u, v);
      if (!isFinite(wgt)) continue;
      const ng = g[u]! + wgt;
      if (ng < g[v]!) {
        g[v] = ng;
        came[v] = u;
        heap.push(v, ng + heuristic(v));
      }
    }
  }
  if (g[b]! === Infinity) return null;
  const path: number[] = [];
  for (let cur = b; cur >= 0; cur = came[cur]!) {
    path.push(cur);
    if (cur === a) break;
  }
  path.reverse();
  return path[0] === a ? path : null;
}
