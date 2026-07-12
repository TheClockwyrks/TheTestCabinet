// Junction — the economy: pollution, land value, RCI demand, and the budget settle
// (specs/economy.md, DESIGN §4, §3.7–§3.8).
//
// Four pieces, run in the tick order sim.ts fixes (pollution + land every tick; RCI + the
// budget once a month):
//   • stepPollution   — industry and jammed roads emit; the field diffuses to neighbours and
//                       decays, forming the haze the renderer stamps.
//   • recomputeLand   — a 0..1 quality per tile: base + water/station amenity + service, minus
//                       pollution and adjacent congestion. It gates how high a tile develops
//                       and scales the tax it pays, closing the pollution→value→growth loop.
//   • updateRci       — eases the three demands toward monthly targets: jobs pull R, people
//                       pull C and I, oversupply pushes a demand negative, tax suppresses all.
//   • settleBudget    — income (Σ occupant·land·tax) minus upkeep adjusts the treasury; a
//                       settle at/past the debt limit that is still negative is bankruptcy.
// The RCI/tax coefficients live in constants.RCI (validated by sim/); the per-capita and
// growth-baseline factors that are not in that table are fixed here.

import {
  DEBT_LIMIT,
  JOBS,
  LAND_AMENITY_MAX,
  LAND_AMENITY_RADIUS,
  LAND_BASE,
  LAND_CONGEST_MAX,
  LAND_POLL_K,
  LAND_SERVICE,
  LAND_STATION,
  LAND_STATION_RADIUS,
  LAND_TIER,
  MONTH_NAMES,
  NET_PIPE,
  NET_RAIL,
  NET_ROAD,
  NET_SPAN,
  NET_STATION,
  NET_WIRE,
  POLL_CONGEST,
  POLL_DECAY,
  POLL_DIFFUSE,
  POLL_EMIT,
  POLL_MAX,
  POP,
  RCI,
  SHOP_CAP,
  SPAN_UPKEEP_EXTRA,
  TAX_CAPITA,
  TILE_COUNT,
  UPKEEP,
} from "./constants";
import { NEIGHBORS, NET_CARRIER, World, colOf, idx, inBounds, rowOf } from "./world";
import type { Game } from "./sim";

// Tunables not in constants.RCI (the demand-loop shape, fixed here per DESIGN §3.8).
const SHOP_PER_CAPITA = 0.5; // shop slots a resident wants
const WORK_PER_CAPITA = 0.5; // fraction of residents that form the workforce
const GOODS_PER_JOB = 0.15; // commercial pull from an industrial job's goods
const RCI_BASE = 55; // latent regional demand when the city is small (fades as it grows)
const RCI_BASE_FADE = 9000; // population at which the growth baseline has faded out
const RCI_DENOM_PAD = 40; // softens the need/supply ratio near zero

// ---- Pollution field (every tick) ----------------------------------------------
export function stepPollution(w: World): void {
  const src = w.pollution;
  // Emit: industry by tier, congested roads by their over-capacity.
  for (let i = 0; i < TILE_COUNT; i++) {
    if (w.developedAt(i) && w.zoneAt(i) === "ind") src[i]! += POLL_EMIT.ind[w.tier[i]!]!;
    if (w.net[i]! & (NET_ROAD | NET_STATION)) {
      const cap = w.cap[i]!;
      if (cap > 0) src[i]! += POLL_CONGEST * Math.max(0, w.load[i]! / cap - 1);
    }
  }
  // Diffuse to 4-neighbours, then decay; clamp.
  const nxt = w.pollScratch;
  nxt.set(src);
  for (let i = 0; i < TILE_COUNT; i++) {
    const p = src[i]!;
    if (p <= 0) continue;
    const col = colOf(i);
    const row = rowOf(i);
    let out = 0;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const share = p * POLL_DIFFUSE;
      nxt[idx(nc, nr)]! += share;
      out += share;
    }
    nxt[i]! -= out;
  }
  for (let i = 0; i < TILE_COUNT; i++) {
    src[i] = Math.max(0, Math.min(POLL_MAX, nxt[i]! * (1 - POLL_DECAY)));
  }
}

// ---- Station land bonus (recomputed on network edits, read each tick) ----------
// Stamps a proximity bonus around every station into `stationBonus`, so land value does not
// re-search for stations each tick.
export function computeStationBonus(w: World): void {
  w.stationBonus.fill(0);
  for (let i = 0; i < TILE_COUNT; i++) {
    if ((w.net[i]! & NET_STATION) === 0) continue;
    const sc = colOf(i);
    const sr = rowOf(i);
    for (let row = sr - LAND_STATION_RADIUS; row <= sr + LAND_STATION_RADIUS; row++) {
      for (let col = sc - LAND_STATION_RADIUS; col <= sc + LAND_STATION_RADIUS; col++) {
        if (!inBounds(col, row)) continue;
        const d = Math.hypot(col - sc, row - sr);
        if (d > LAND_STATION_RADIUS) continue;
        const bonus = LAND_STATION * (1 - d / LAND_STATION_RADIUS);
        const j = idx(col, row);
        if (bonus > w.stationBonus[j]!) w.stationBonus[j] = bonus;
      }
    }
  }
}

// ---- Land value (every tick) ---------------------------------------------------
export function recomputeLand(w: World): void {
  for (let i = 0; i < TILE_COUNT; i++) {
    let v = LAND_BASE;
    // Water amenity (static distance field) + station amenity (stamped on edit).
    const wd = w.waterDist[i]!;
    if (wd <= LAND_AMENITY_RADIUS) v += LAND_AMENITY_MAX * (1 - wd / LAND_AMENITY_RADIUS);
    v += w.stationBonus[i]!;
    // Reliable service.
    if (w.powered[i]! && w.watered[i]! && w.access[i]!) v += LAND_SERVICE;
    // Pollution drags it down.
    v -= LAND_POLL_K * (w.pollution[i]! / POLL_MAX);
    // Adjacent congestion drags it down.
    let over = 0;
    const col = colOf(i);
    const row = rowOf(i);
    for (const [dc, dr] of NEIGHBORS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      const j = idx(nc, nr);
      const cap = w.cap[j]!;
      if (cap > 0) over = Math.max(over, w.load[j]! / cap - 1);
    }
    v -= LAND_CONGEST_MAX * Math.min(1, Math.max(0, over));
    w.land[i] = Math.max(0, Math.min(1, v));
  }
}

// The land floor a target tier requires (specs/economy.md); tier 1 has no floor.
export function landFloorForTier(tier: number): number {
  return LAND_TIER[Math.max(1, Math.min(3, tier))]!;
}

// ---- RCI demand (monthly) ------------------------------------------------------
export function updateRci(game: Game): void {
  const w = game.world;
  let pop = 0;
  let comJobs = 0;
  let indJobs = 0;
  let shops = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!w.developedAt(i)) continue;
    const t = w.tier[i]!;
    const z = w.zoneAt(i)!;
    if (z === "res") pop += POP.res[t]!;
    else if (z === "com") {
      comJobs += JOBS.com[t]!;
      shops += SHOP_CAP.com[t]!;
    } else indJobs += JOBS.ind[t]!;
  }
  const jobs = comJobs + indJobs;
  const tax = game.budget.taxRate;
  const base = RCI_BASE * Math.max(0, 1 - pop / RCI_BASE_FADE);

  const rTarget = demand(base, RCI.r.jobPull * jobs, RCI.r.vacancyPen * pop, tax);
  const cTarget = demand(base, RCI.c.shopPull * pop * SHOP_PER_CAPITA + RCI.c.goodsPull * indJobs * GOODS_PER_JOB, RCI.c.oversupply * shops, tax);
  const iTarget = demand(base, RCI.i.comPull * shops + RCI.i.workforcePull * pop * WORK_PER_CAPITA, RCI.i.oversupply * indJobs, tax);

  game.rci.r += (rTarget - game.rci.r) * RCI.ease;
  game.rci.c += (cTarget - game.rci.c) * RCI.ease;
  game.rci.d += (iTarget - game.rci.d) * RCI.ease;
}

// One demand target in [-clamp, clamp]: a growth baseline plus the normalized (need−supply)
// pressure, less the tax penalty. Positive need with little supply → strong demand; oversupply
// → negative (a surplus that abandons); a high tax rate suppresses all three.
function demand(base: number, need: number, supply: number, tax: number): number {
  const t = base + ((need - supply) / (need + supply + RCI_DENOM_PAD)) * RCI.clamp - RCI.taxPen * tax;
  return Math.max(-RCI.clamp, Math.min(RCI.clamp, t));
}

// ---- Budget settle (monthly) ---------------------------------------------------
export function settleBudget(game: Game): void {
  const w = game.world;
  const tax = game.budget.taxRate;
  let income = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    if (!w.developedAt(i)) continue;
    const t = w.tier[i]!;
    const z = w.zoneAt(i)!;
    const occupants = z === "res" ? POP.res[t]! : z === "com" ? JOBS.com[t]! : JOBS.ind[t]!;
    income += occupants * w.land[i]! * tax * TAX_CAPITA;
  }
  const upkeep = computeUpkeep(w);
  const balance = income - upkeep;

  game.budget.treasury += balance;
  game.budget.income = income;
  game.budget.upkeep = upkeep;
  game.budget.balance = balance;

  // Advance the clock and the survived-months tally.
  game.stats.monthsSurvived += 1;
  game.clock.month += 1;
  if (game.clock.month >= MONTH_NAMES.length) {
    game.clock.month = 0;
    game.clock.year += 1;
  }

  // Bankruptcy: out of credit (treasury at/past the debt limit) and still losing money.
  if (game.budget.treasury <= DEBT_LIMIT && balance < 0) game.declareBankrupt();
}

// Monthly upkeep from every placed link and source (specs/transit.md, specs/utilities.md).
export function computeUpkeep(w: World): number {
  let total = 0;
  for (let i = 0; i < TILE_COUNT; i++) {
    const n = w.net[i]!;
    if ((n & NET_CARRIER) === 0) continue;
    if (n & NET_ROAD) total += UPKEEP.road;
    if (n & NET_RAIL) total += UPKEEP.rail;
    if (n & NET_STATION) total += UPKEEP.station;
    if (n & NET_WIRE) total += UPKEEP.wire;
    if (n & NET_PIPE) total += UPKEEP.pipe;
    if (n & NET_SPAN) total += SPAN_UPKEEP_EXTRA;
  }
  for (const src of w.sources) total += UPKEEP[src.kind];
  return total;
}
