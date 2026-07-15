// Deepcore — the Credits economy (specs/mining.md, specs/flow.md, specs/upgrades.md).
//
// One source (selling ore at the Ore Market) and three sinks (Fuel Depot fuel/repair,
// upgrades, rocket parts). Credits are banked and never go negative; an action you cannot
// afford is disabled. This module owns cargo accounting, selling, buying fuel/repair at
// the Fuel Depot, and buying the seven upgrade tracks; the rocket sink lives in rocket.ts.

import {
  CARGO_CAPACITY,
  FUEL_COST_PER_UNIT,
  MAX_TIER,
  ORES,
  REPAIR_COST_PER_POINT,
  UPGRADE_TRACKS,
} from "./constants";
import type { Cargo, Ore, UpgradeTrack } from "./types";
import type { Game } from "./game";

/** Total units (piece count) currently in the cargo bay — the SLOTS filled (specs/mining.md). */
export function cargoUsed(cargo: Cargo): number {
  let n = 0;
  for (const o of Object.keys(cargo) as Ore[]) n += cargo[o];
  return n;
}

/** Total WEIGHT (kg) currently in the cargo bay — what the jetpack must lift on the climb
 *  home (specs/character.md). Separate from the slot capacity that limits pickup. */
export function cargoWeight(cargo: Cargo): number {
  let kg = 0;
  for (const o of Object.keys(cargo) as Ore[]) kg += cargo[o] * ORES[o].weightKg;
  return kg;
}

/** Value the current cargo would fetch at the Ore Market. */
export function cargoValue(cargo: Cargo): number {
  let total = 0;
  for (const o of Object.keys(cargo) as Ore[]) total += cargo[o] * ORES[o].value;
  return total;
}

/**
 * Try to add one unit of ore to cargo; false if the bay is already full by SLOT COUNT
 * (specs/mining.md). Cargo is limited by a number of slots (one unit per slot, any weight),
 * the Motherload model — weight is a separate concern that the jetpack fights on the climb
 * (specs/character.md). When this returns false the caller still clears the drilled tile;
 * the ore is simply left behind, never a hard-lock (specs/mining.md, drill.ts).
 */
export function collectOre(game: Game, ore: Ore): boolean {
  if (cargoUsed(game.cargo) >= game.cargoCap()) return false;
  game.cargo[ore]++;
  return true;
}

/**
 * Drop one unit of a SPECIFIC ore from the bay (specs/mining.md) — the player's control for
 * ditching a heavy haul from the inventory so an overloaded miner can lift off again
 * (specs/character.md). The dropped ore is lost, not sold. Returns true if a unit was
 * dropped (false if none of that ore is held).
 */
export function dropOre(game: Game, ore: Ore): boolean {
  if (game.cargo[ore] <= 0) return false;
  game.cargo[ore]--;
  game.sndQueue.push("impact");
  return true;
}

/** Sell the whole cargo for Credits and empty the bay (specs/mining.md). */
export function sellCargo(game: Game): number {
  const total = cargoValue(game.cargo);
  if (total <= 0) return 0;
  game.credits += total;
  game.creditsEarned += total;
  for (const o of Object.keys(game.cargo) as Ore[]) game.cargo[o] = 0;
  game.sndQueue.push("fabricate");
  return total;
}

// ---------------------------------------------------------------------------
// Fuel Depot — buying fuel and hull repair (specs/character.md, specs/world.md)
// ---------------------------------------------------------------------------

/** How much fuel the tank is short of its current maximum. */
export function fuelDeficit(game: Game): number {
  return Math.max(0, game.maxFuel() - game.miner.fuel);
}

/** How many hull points are missing from the current maximum. */
export function hullDeficit(game: Game): number {
  return Math.max(0, game.maxHull() - game.miner.hull);
}

/** Whole-Credit cost to buy `units` of fuel (rounded up — Credits are always integer). */
export function fuelCost(units: number): number {
  return Math.ceil(units * FUEL_COST_PER_UNIT);
}

/** Whole-Credit cost to repair `points` of hull (rounded up). */
export function repairCost(points: number): number {
  return Math.ceil(points * REPAIR_COST_PER_POINT);
}

/**
 * Buy up to `units` of fuel at the Fuel Depot (specs/character.md). Buys only as much as
 * is missing and as much as the miner can afford — pass `Infinity` for "fill to full".
 * Credits are spent in whole numbers (cost rounded up); if the full amount is unaffordable
 * the miner spends every remaining Credit on as much fuel as it buys. Returns units bought.
 */
export function buyFuel(game: Game, units: number): number {
  if (FUEL_COST_PER_UNIT <= 0) {
    const free = Math.min(units, fuelDeficit(game));
    if (free > 0) game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + free);
    return Math.max(0, free);
  }
  const want = Math.min(units, fuelDeficit(game));
  if (want <= 0) return 0;
  let cost = fuelCost(want);
  let bought = want;
  if (cost > game.credits) {
    cost = game.credits; // can't afford the full top-up — spend all remaining Credits
    bought = cost / FUEL_COST_PER_UNIT;
  }
  if (bought <= 0) return 0;
  game.credits -= cost;
  game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + bought);
  game.sndQueue.push("fabricate");
  return bought;
}

/**
 * Buy up to `points` of hull repair at the Fuel Depot (specs/character.md). Buys only the
 * missing hull, capped by affordability (spending all remaining Credits on a partial repair
 * when the full one is unaffordable); `Infinity` repairs to full. Credits spent are whole.
 * Returns the hull points actually repaired.
 */
export function buyRepair(game: Game, points: number): number {
  if (REPAIR_COST_PER_POINT <= 0) {
    const free = Math.min(points, hullDeficit(game));
    if (free > 0) game.miner.hull = Math.min(game.maxHull(), game.miner.hull + free);
    return Math.max(0, free);
  }
  const want = Math.min(points, hullDeficit(game));
  if (want <= 0) return 0;
  let cost = repairCost(want);
  let bought = want;
  if (cost > game.credits) {
    cost = game.credits; // spend all remaining Credits on a partial repair
    bought = cost / REPAIR_COST_PER_POINT;
  }
  if (bought <= 0) return 0;
  game.credits -= cost;
  game.miner.hull = Math.min(game.maxHull(), game.miner.hull + bought);
  game.sndQueue.push("fabricate");
  return bought;
}

/** The price to reach the next tier on a track, or null if maxed. */
export function nextUpgradePrice(game: Game, track: UpgradeTrack): number | null {
  const tier = game.tiers[track]; // current tier 1..5
  if (tier >= MAX_TIER) return null;
  return UPGRADE_TRACKS[track].prices[tier]!; // prices[tier] is the cost of tier+1
}

/** Buy the next tier on a track if affordable and not maxed (specs/upgrades.md). */
export function buyUpgrade(game: Game, track: UpgradeTrack): boolean {
  const price = nextUpgradePrice(game, track);
  if (price === null || game.credits < price) return false;
  game.credits -= price;
  game.tiers[track]++;
  game.sndQueue.push("fabricate");
  return true;
}

/** Fresh, empty cargo (all ores at 0). */
export function emptyCargo(): Cargo {
  return { ferron: 0, cuprite: 0, argenite: 0, voltite: 0, pyronium: 0, adamite: 0 };
}

/** Starting cargo capacity, for the tier-1 bay. */
export const START_CARGO_CAP = CARGO_CAPACITY[0]!;
