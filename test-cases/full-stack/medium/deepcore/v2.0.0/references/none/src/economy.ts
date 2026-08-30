// Deepcore — the Credits economy (specs/gameplay.md, specs/mining.md, specs/upgrades.md).
//
// One source, selling the cargo at the Ore Market, and four sinks: fuel and repair at
// the Fuel Depot, an upgrade tier, a field supply, and a rocket component. Credits
// never go negative and an action that cannot be afforded changes nothing. Cargo
// accounting, selling, the depot, and the upgrade tracks live here; the rocket sink
// lives in rocket.ts and the supply sink in items.ts.

import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  ORES,
  ORE_IDS,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  upgradePrice,
} from "./constants";
import type { Cargo, Ore, UpgradeTrack } from "./types";
import type { Game } from "./game";

/** How many slots the bay currently holds, one per unit whatever its weight. */
export function cargoUsed(cargo: Cargo): number {
  let n = 0;
  for (const o of ORE_IDS) n += cargo[o];
  return n;
}

/** The weight in the bay, which is what the jetpack must lift on the climb home. */
export function cargoWeight(cargo: Cargo): number {
  let kg = 0;
  for (const o of ORE_IDS) kg += cargo[o] * ORES[o].weightKg;
  return kg;
}

/** What the bay would fetch at the Ore Market. */
export function cargoValue(cargo: Cargo): number {
  let total = 0;
  for (const o of ORE_IDS) total += cargo[o] * ORES[o].value;
  return total;
}

/** An empty bay. */
export function emptyCargo(): Cargo {
  const cargo = {} as Cargo;
  for (const o of ORE_IDS) cargo[o] = 0;
  return cargo;
}

/**
 * Bank one unit of ore, or report that the bay is full by slot count. The caller
 * clears the cell either way, so a full bay never leaves solid rock underfoot.
 */
export function collectOre(game: Game, ore: Ore): boolean {
  if (cargoUsed(game.cargo) >= game.cargoCap()) return false;
  game.cargo[ore]++;
  return true;
}

/** Discard one unit of an ore. The unit is lost rather than sold. */
export function dropOre(game: Game, ore: Ore): boolean {
  if (game.cargo[ore] <= 0) return false;
  game.cargo[ore]--;
  game.sndQueue.push("impact");
  return true;
}

/** Sell the whole cargo and empty the bay. */
export function sellCargo(game: Game): number {
  const total = cargoValue(game.cargo);
  if (total <= 0) return 0;
  game.credits += total;
  game.creditsEarned += total;
  for (const o of ORE_IDS) game.cargo[o] = 0;
  game.sndQueue.push("fabricate");
  game.note("CARGO SOLD");
  return total;
}

// ---------------------------------------------------------------------------
// The Fuel Depot (specs/gameplay.md)
// ---------------------------------------------------------------------------

/** How much fuel the tank is short of its maximum. */
export function fuelDeficit(game: Game): number {
  return Math.max(0, game.maxFuel() - game.miner.fuel);
}

/** How many hull points are missing from the maximum. */
export function hullDeficit(game: Game): number {
  return Math.max(0, game.maxHull() - game.miner.hull);
}

/** Whole Credits `units` of fuel costs. */
export function fuelCost(units: number): number {
  return Math.ceil(units * FUEL_PRICE);
}

/** Whole Credits `points` of hull repair costs. */
export function repairCost(points: number): number {
  return Math.ceil(points * REPAIR_PRICE);
}

/** Buy the depot's fixed fuel increment, or nothing when it is unaffordable. */
export function buyFuel(game: Game): number {
  const want = Math.min(FUEL_BUY_INCREMENT, fuelDeficit(game));
  if (want <= 0) {
    game.note("FUEL ALREADY FULL");
    return 0;
  }
  const cost = fuelCost(want);
  if (cost > game.credits) {
    game.note("NOT ENOUGH CREDITS");
    return 0;
  }
  game.credits -= cost;
  game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + want);
  game.sndQueue.push("fabricate");
  return want;
}

/** Fill the tank, paying only for what is missing and only as far as the Credits reach. */
export function fillFuel(game: Game): number {
  const missing = fuelDeficit(game);
  if (missing <= 0) {
    game.note("FUEL ALREADY FULL");
    return 0;
  }
  const affordable = FUEL_PRICE > 0 ? game.credits / FUEL_PRICE : missing;
  const bought = Math.min(missing, affordable);
  if (bought <= 0) {
    game.note("NOT ENOUGH CREDITS");
    return 0;
  }
  game.credits -= fuelCost(bought);
  game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + bought);
  game.sndQueue.push("fabricate");
  return bought;
}

/** Buy the depot's fixed repair increment, or nothing when it is unaffordable. */
export function buyRepair(game: Game): number {
  const want = Math.min(REPAIR_BUY_INCREMENT, hullDeficit(game));
  if (want <= 0) {
    game.note("HULL ALREADY FULL");
    return 0;
  }
  const cost = repairCost(want);
  if (cost > game.credits) {
    game.note("NOT ENOUGH CREDITS");
    return 0;
  }
  game.credits -= cost;
  game.miner.hull = Math.min(game.maxHull(), game.miner.hull + want);
  game.sndQueue.push("fabricate");
  return want;
}

/** Repair to full, on the same terms as filling the tank. */
export function repairFull(game: Game): number {
  const missing = hullDeficit(game);
  if (missing <= 0) {
    game.note("HULL ALREADY FULL");
    return 0;
  }
  const affordable = REPAIR_PRICE > 0 ? game.credits / REPAIR_PRICE : missing;
  const bought = Math.min(missing, affordable);
  if (bought <= 0) {
    game.note("NOT ENOUGH CREDITS");
    return 0;
  }
  game.credits -= repairCost(bought);
  game.miner.hull = Math.min(game.maxHull(), game.miner.hull + bought);
  game.sndQueue.push("fabricate");
  return bought;
}

// ---------------------------------------------------------------------------
// The Upgrade Shop (specs/upgrades.md)
// ---------------------------------------------------------------------------

/** The price of the next tier on a track, or null once it is maxed out. */
export function nextUpgradePrice(
  game: Game,
  track: UpgradeTrack,
): number | null {
  return upgradePrice(track, game.tiers[track]);
}

/**
 * Buy the next tier on a track. A bigger fuel tank or hull raises the maximum and
 * adds the same amount to the value held, which is added capacity rather than a
 * refill; the other five tracks change their derived figure alone.
 */
export function buyUpgrade(game: Game, track: UpgradeTrack): boolean {
  const price = nextUpgradePrice(game, track);
  if (price === null) {
    game.note("ALREADY AT THE TOP TIER");
    return false;
  }
  if (game.credits < price) {
    game.note("NOT ENOUGH CREDITS");
    return false;
  }
  const fuelBefore = game.maxFuel();
  const hullBefore = game.maxHull();
  game.credits -= price;
  game.tiers[track]++;
  if (track === "fuel") {
    game.miner.fuel = Math.min(
      game.maxFuel(),
      game.miner.fuel + (game.maxFuel() - fuelBefore),
    );
  } else if (track === "hull") {
    game.miner.hull = Math.min(
      game.maxHull(),
      game.miner.hull + (game.maxHull() - hullBefore),
    );
  }
  game.sndQueue.push("fabricate");
  return true;
}
