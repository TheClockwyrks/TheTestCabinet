// Deepcore — the Credits economy (specs/expedition.md, specs/mining.md,
// specs/upgrades.md).
//
// One source, selling the cargo at the Ore Market, and four sinks: fuel and
// repair at the Fuel Depot, an upgrade tier, a field supply, and a rocket
// component. Credits never go negative and an action that cannot be afforded
// changes nothing. Cargo accounting, selling, the depot, and the upgrade tracks
// live here; the rocket sink lives in `src/rocket.ts` and the supply sink in
// `src/items.ts`.

import {
  CUES,
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  MINERALS,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
} from "./constants";
import type { OreId, TrackName } from "./constants";
import { cue } from "./audio";
import { note } from "./feedback";
import { cargoCap, cargoValue, maxFuel, maxHull, slotsUsed } from "./figures";
import type { DeepcoreState, UpgradeTiers } from "./game";
import { upgradePrice } from "./tuning";

/**
 * Bank one unit of a mineral, or report that the bay is full by slot count. The
 * caller clears the cell either way, so a full bay never leaves solid rock
 * underfoot.
 */
export function collectOre(d: DeepcoreState, ore: OreId): boolean {
  if (slotsUsed(d.cargo) >= cargoCap(d.tiers)) return false;
  d.cargo[ore] += 1;
  return true;
}

/** Discard one unit of a mineral. The unit is lost rather than sold. */
export function dropOre(d: DeepcoreState, ore: OreId): boolean {
  if (d.cargo[ore] <= 0) return false;
  d.cargo[ore] -= 1;
  cue(d, CUES.impact);
  return true;
}

/** Sell the whole cargo and empty the bay. */
export function sellCargo(d: DeepcoreState): number {
  const total = cargoValue(d.cargo);
  if (total <= 0) return 0;
  d.credits += total;
  d.creditsEarned += total;
  for (const mineral of MINERALS) d.cargo[mineral.id] = 0;
  cue(d, CUES.fabricate);
  note(d, "CARGO SOLD");
  return total;
}

// ---- The Fuel Depot (specs/expedition.md) ----------------------------------

/** How much fuel the tank is short of its maximum. */
export function fuelDeficit(fuel: number, tiers: UpgradeTiers): number {
  return Math.max(0, maxFuel(tiers) - fuel);
}

/** How many hull points are missing from the maximum. */
export function hullDeficit(hull: number, tiers: UpgradeTiers): number {
  return Math.max(0, maxHull(tiers) - hull);
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
export function buyFuel(d: DeepcoreState): number {
  const want = Math.min(FUEL_BUY_INCREMENT, fuelDeficit(d.miner.fuel, d.tiers));
  if (want <= 0) {
    note(d, "FUEL ALREADY FULL");
    return 0;
  }
  const cost = fuelCost(want);
  if (cost > d.credits) {
    note(d, "NOT ENOUGH CREDITS");
    return 0;
  }
  d.credits -= cost;
  d.miner.fuel = Math.min(maxFuel(d.tiers), d.miner.fuel + want);
  cue(d, CUES.fabricate);
  return want;
}

/**
 * Fill the tank, paying only for what is missing and only as far as the Credits
 * reach.
 */
export function fillFuel(d: DeepcoreState): number {
  const missing = fuelDeficit(d.miner.fuel, d.tiers);
  if (missing <= 0) {
    note(d, "FUEL ALREADY FULL");
    return 0;
  }
  const affordable = FUEL_PRICE > 0 ? d.credits / FUEL_PRICE : missing;
  const bought = Math.min(missing, affordable);
  if (bought <= 0) {
    note(d, "NOT ENOUGH CREDITS");
    return 0;
  }
  d.credits -= fuelCost(bought);
  d.miner.fuel = Math.min(maxFuel(d.tiers), d.miner.fuel + bought);
  cue(d, CUES.fabricate);
  return bought;
}

/** Buy the depot's fixed repair increment, or nothing when it is unaffordable. */
export function buyRepair(d: DeepcoreState): number {
  const want = Math.min(
    REPAIR_BUY_INCREMENT,
    hullDeficit(d.miner.hull, d.tiers),
  );
  if (want <= 0) {
    note(d, "HULL ALREADY FULL");
    return 0;
  }
  const cost = repairCost(want);
  if (cost > d.credits) {
    note(d, "NOT ENOUGH CREDITS");
    return 0;
  }
  d.credits -= cost;
  d.miner.hull = Math.min(maxHull(d.tiers), d.miner.hull + want);
  cue(d, CUES.fabricate);
  return want;
}

/** Repair to full, on the same terms as filling the tank. */
export function repairFull(d: DeepcoreState): number {
  const missing = hullDeficit(d.miner.hull, d.tiers);
  if (missing <= 0) {
    note(d, "HULL ALREADY FULL");
    return 0;
  }
  const affordable = REPAIR_PRICE > 0 ? d.credits / REPAIR_PRICE : missing;
  const bought = Math.min(missing, affordable);
  if (bought <= 0) {
    note(d, "NOT ENOUGH CREDITS");
    return 0;
  }
  d.credits -= repairCost(bought);
  d.miner.hull = Math.min(maxHull(d.tiers), d.miner.hull + bought);
  cue(d, CUES.fabricate);
  return bought;
}

// ---- The Upgrade Shop (specs/upgrades.md) --------------------------------

/** The price of the next tier on a track, or `null` once it is maxed out. */
export function nextUpgradePrice(
  tiers: UpgradeTiers,
  track: TrackName,
): number | null {
  return upgradePrice(track, tiers[track]);
}

/**
 * Buy the next tier on a track. A bigger fuel tank or hull raises the maximum
 * and adds the same amount to the value held, which is added capacity rather
 * than a refill; the other five tracks change their derived figure alone.
 */
export function buyUpgrade(d: DeepcoreState, track: TrackName): boolean {
  const price = nextUpgradePrice(d.tiers, track);
  if (price === null) {
    note(d, "ALREADY AT THE TOP TIER");
    return false;
  }
  if (d.credits < price) {
    note(d, "NOT ENOUGH CREDITS");
    return false;
  }
  const fuelBefore = maxFuel(d.tiers);
  const hullBefore = maxHull(d.tiers);
  d.credits -= price;
  d.tiers[track] += 1;
  if (track === "fuel") {
    d.miner.fuel = Math.min(
      maxFuel(d.tiers),
      d.miner.fuel + (maxFuel(d.tiers) - fuelBefore),
    );
  } else if (track === "hull") {
    d.miner.hull = Math.min(
      maxHull(d.tiers),
      d.miner.hull + (maxHull(d.tiers) - hullBefore),
    );
  }
  cue(d, CUES.fabricate);
  return true;
}
