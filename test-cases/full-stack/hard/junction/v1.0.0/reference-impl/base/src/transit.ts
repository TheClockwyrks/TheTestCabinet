// Junction — the transit flow: the signature system (specs/transit.md, DESIGN §4).
//
// Each tick this rebuilds road access, assigns the city's trips onto the network, and
// derives the per-link congestion that feeds back into pathing. The model is AGGREGATE FLOW
// (the spec allows it): residents commute from every developed R tile to the nearest jobs /
// shops, and industry ships goods to the nearest commerce; each trip is routed on a
// multi-source shortest-path tree (`graph.routeField`, weighted by live travel time) and its
// weight laid onto every link it crosses. A link over capacity CONGESTS — its travel time
// climbs, so next tick some trips reroute and the ones that must cross it take longer,
// capping growth through land value. A parallel rail line (cheaper steps, its own capacity)
// pulls through-traffic off a jammed road corridor — the observable payoff the spec wants.
// Visible vehicles are sampled from the active routes for legibility; the load they ride is
// the real computed flow, not decoration.

import {
  COMMUTE_FRAC,
  JOBS,
  MAP_COLS,
  NET_RAIL,
  NET_ROAD,
  NET_STATION,
  POP,
  RAIL_CAP,
  ROAD_CAP,
  TILE,
  TILE_COUNT,
  VEHICLE_CAP_ON_SCREEN,
  WALK_TILES,
} from "./constants";
import { RouteField, routeField } from "./graph";
import { NEIGHBORS, World, colOf, idx, inBounds, rowOf } from "./world";
import type { Vehicle, VehicleKind } from "./types";
import type { Game } from "./sim";

const VEHICLE_SPEED = 150; // px/s a free-flowing vehicle covers (scaled down by congestion)
const GOODS_FRAC = 0.28; // share of an industry tile's jobs shipped as goods trips
const SPAWN_CHANCE = 0.06; // per eligible trip source per tick, a visible vehicle is sampled

export function stepTransit(game: Game, dt: number): void {
  const w = game.world;

  // Roll last tick's load forward (the congestion weight source) and clear this tick's.
  w.prevLoad.set(w.load);
  w.load.fill(0);
  computeCaps(w);
  computeAccess(w);

  // Destinations: developed commerce/industry (jobs + shops) for residents, commerce for
  // goods. Route to the access node each destination reaches the network through.
  const jobDests = new Set<number>();
  const comDests = new Set<number>();
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!w.developedAt(i)) continue;
    const an = w.accessNode[i]!;
    if (an < 0) continue;
    const z = w.zoneAt(i)!;
    if (z === "com" || z === "ind") jobDests.add(an);
    if (z === "com") comDests.add(an);
  }

  const jobField = jobDests.size > 0 ? routeField(w, [...jobDests]) : null;
  const comField = comDests.size > 0 ? routeField(w, [...comDests]) : null;

  // Residents → jobs/shops.
  if (jobField) {
    for (let i = 0; i < TILE_COUNT; i++) {
      if (w.zoneAt(i) !== "res" || w.tier[i]! === 0) continue;
      const an = w.accessNode[i]!;
      if (an < 0 || jobField.dist[an]! === Infinity) continue;
      const trips = COMMUTE_FRAC * POP.res[w.tier[i]!]!;
      const path = layTripLoad(w, jobField, an, trips);
      maybeSpawn(game, path, pathHasRail(w, path) ? "tram" : "car");
    }
  }
  // Industry → commerce (goods).
  if (comField) {
    for (let i = 0; i < TILE_COUNT; i++) {
      if (w.zoneAt(i) !== "ind" || w.tier[i]! === 0) continue;
      const an = w.accessNode[i]!;
      if (an < 0 || comField.dist[an]! === Infinity) continue;
      const trips = GOODS_FRAC * JOBS.ind[w.tier[i]!]!;
      const path = layTripLoad(w, comField, an, trips);
      maybeSpawn(game, path, "truck");
    }
  }

  stepVehicles(game, dt);
}

// Per-link capacity from the carrier kind (specs/transit.md): a station reads as a road
// access point (road capacity); rail segments carry far more, so they offload roads.
function computeCaps(w: World): void {
  w.cap.fill(0);
  for (let i = 0; i < TILE_COUNT; i++) {
    const n = w.net[i]!;
    if (n & (NET_ROAD | NET_STATION)) w.cap[i] = ROAD_CAP;
    else if (n & NET_RAIL) w.cap[i] = RAIL_CAP;
  }
}

// A zoned tile has road access when it is within WALK_TILES of the road network; the nearest
// road/station tile is its entry node into the transit graph. Multi-source BFS from every
// road/station tile fills both `access` and `accessNode` in one pass.
function computeAccess(w: World): void {
  w.access.fill(0);
  w.accessNode.fill(-1);
  const depth = new Int8Array(TILE_COUNT).fill(-1);
  const queue: number[] = [];
  let head = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (w.net[i]! & (NET_ROAD | NET_STATION)) {
      w.access[i] = 1;
      w.accessNode[i] = i;
      depth[i] = 0;
      queue.push(i);
    }
  }
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = depth[cur]!;
    if (d >= WALK_TILES) continue;
    const col = colOf(cur);
    const row = rowOf(cur);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const j = idx(nc, nr);
      if (depth[j]! >= 0) continue; // already reached (a nearer road claimed it)
      depth[j] = d + 1;
      w.access[j] = 1;
      w.accessNode[j] = w.accessNode[cur]!;
      queue.push(j);
    }
  }
}

// Walk the shortest-path tree from a trip's access node to its nearest destination, adding
// `trips` to every link crossed, and return the tile path (home → destination) for vehicles.
function layTripLoad(w: World, field: RouteField, start: number, trips: number): number[] {
  const path: number[] = [];
  let cur = start;
  let guard = 0;
  while (cur >= 0 && guard++ < TILE_COUNT) {
    w.load[cur]! += trips;
    path.push(cur);
    if (field.dist[cur]! <= 0) break; // reached a destination node
    cur = field.parent[cur]!;
  }
  return path;
}

function pathHasRail(w: World, path: number[]): boolean {
  for (const i of path) if (w.net[i]! & NET_RAIL) return true;
  return false;
}

// Sample a visible vehicle from an active route, within the on-screen budget.
function maybeSpawn(game: Game, path: number[], kind: VehicleKind): void {
  if (path.length < 2) return;
  if (game.vehicles.length >= VEHICLE_CAP_ON_SCREEN) return;
  if (!game.rng.bool(SPAWN_CHANCE)) return;
  game.vehicles.push({
    id: game.nextVehicleId++,
    kind,
    path: path.slice(),
    seg: 0,
    t: 0,
    speed: VEHICLE_SPEED,
    angle: 0,
    animT: 0,
  });
}

// Advance the sampled vehicles along their tile paths, slowed by the congestion of the link
// they are on; retire them at the end of the route.
function stepVehicles(game: Game, dt: number): void {
  const w = game.world;
  const alive: Vehicle[] = [];
  for (const v of game.vehicles) {
    v.animT += dt;
    const from = v.path[v.seg]!;
    const cap = w.cap[from]!;
    const congest = cap > 0 ? 1 + Math.max(0, w.load[from]! / cap - 1) : 1;
    const tilesPerSec = v.speed / TILE / congest;
    v.t += tilesPerSec * dt;
    while (v.t >= 1 && v.seg < v.path.length - 1) {
      v.t -= 1;
      v.seg++;
    }
    if (v.seg >= v.path.length - 1) continue; // reached the destination — retire
    const a = v.path[v.seg]!;
    const b = v.path[v.seg + 1]!;
    v.angle = Math.atan2(rowOf(b) - rowOf(a), colOf(b) - colOf(a));
    alive.push(v);
  }
  game.vehicles = alive;
}

// The current interpolated world-pixel position of a vehicle (for the renderer).
export function vehiclePos(v: Vehicle): { x: number; y: number } {
  const a = v.path[v.seg]!;
  const b = v.path[Math.min(v.seg + 1, v.path.length - 1)]!;
  const ax = (colOf(a) + 0.5) * TILE;
  const ay = (rowOf(a) + 0.5) * TILE;
  const bx = (colOf(b) + 0.5) * TILE;
  const by = (rowOf(b) + 0.5) * TILE;
  const t = Math.max(0, Math.min(1, v.t));
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

// ---- Traffic signals at road junctions (animated in render) --------------------
// A road tile with three or more road neighbours is a junction; it carries an animated
// signal. Rebuilt on any network edit so the signal set tracks the roads.
export function rebuildSignals(game: Game): void {
  const w = game.world;
  const signals = game.signals;
  signals.length = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((w.net[i]! & NET_ROAD) === 0) continue;
    const col = i % MAP_COLS;
    const row = (i / MAP_COLS) | 0;
    let n = 0;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (inBounds(nc, nr) && w.net[idx(nc, nr)]! & NET_ROAD) n++;
    }
    if (n >= 3) signals.push({ col, row, phase: game.rng.next() });
  }
}
