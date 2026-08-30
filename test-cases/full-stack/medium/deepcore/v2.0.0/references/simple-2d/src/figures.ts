// Deepcore — the figures the upgrade tiers and the cargo bay derive
// (specs/upgrades.md, specs/mining.md, specs/character.md).
//
// Everything here is a pure function of the data it is handed. Each takes the
// part of the state it reads — the tiers, the bay, the miner — rather than the
// whole state, so a rule that depends on the fuel tier says so in its signature
// and a caller can work out any of these from a saved expedition just as well as
// from a live one.

import {
  CARGO_TIERS,
  CLIMB_CAP_FLOOR,
  DRILL_DAMAGE_TIERS,
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_LOADED,
  FUEL_TIERS,
  HULL_TIERS,
  JETPACK_TIERS,
  METERS_PER_ROW,
  MINER_H,
  MINERALS,
  RADIATOR_TIERS,
  SCANNER_TIERS,
  SURFACE_Y,
  TILE,
} from "./constants";
import type { JetpackTier, Mineral, OreId } from "./constants";
import type { Cargo, Miner, UpgradeTiers } from "./game";
import { rowAtY } from "./world";
import { SURFACE_ROW } from "./tuning";

/** One rung of a ladder, clamped so a tier outside the ladder never reads `undefined`. */
function rung<T>(ladder: readonly T[], tier: number): T {
  return ladder[Math.min(ladder.length - 1, Math.max(0, tier - 1))] as T;
}

// ---- What a tier buys ----------------------------------------------------

/** The fuel tank's maximum at the fuel tier. */
export function maxFuel(tiers: UpgradeTiers): number {
  return rung(FUEL_TIERS, tiers.fuel);
}

/** The hull's maximum at the hull tier. */
export function maxHull(tiers: UpgradeTiers): number {
  return rung(HULL_TIERS, tiers.hull);
}

/** The cargo bay's capacity in ore slots at the cargo tier. */
export function cargoCap(tiers: UpgradeTiers): number {
  return rung(CARGO_TIERS, tiers.cargo);
}

/** The health one drill hit removes at the drill tier. */
export function drillDamage(tiers: UpgradeTiers): number {
  return rung(DRILL_DAMAGE_TIERS, tiers.drill);
}

/** The fraction lava damage is reduced by at the radiator tier. */
export function radiatorEffect(tiers: UpgradeTiers): number {
  return rung(RADIATOR_TIERS, tiers.radiator);
}

/** The scanner's lock range in tiles, `0` at the tier that is no scanner at all. */
export function scannerRangeTiles(tiers: UpgradeTiers): number {
  return rung(SCANNER_TIERS, tiers.scanner) ?? 0;
}

/** The jetpack's rung at the jetpack tier. */
export function jetpackRung(tiers: UpgradeTiers): JetpackTier {
  return rung(JETPACK_TIERS, tiers.jetpack);
}

/** The heaviest load the jetpack still climbs with, in kilograms. */
export function liftLimitKg(tiers: UpgradeTiers): number {
  return jetpackRung(tiers).liftLimitKg;
}

// ---- What the bay holds --------------------------------------------------

/** The mineral table entry an id names. */
export function mineral(id: OreId): Mineral {
  const entry = MINERALS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Deepcore: no mineral named ${id}`);
  return entry;
}

/** How many slots the bay holds, one per unit whatever the unit weighs. */
export function slotsUsed(cargo: Cargo): number {
  let used = 0;
  for (const entry of MINERALS) used += cargo[entry.id];
  return used;
}

/** The weight in the bay, which is what the jetpack must lift on the climb home. */
export function loadKg(cargo: Cargo): number {
  let kg = 0;
  for (const entry of MINERALS) kg += cargo[entry.id] * entry.weightKg;
  return kg;
}

/** What the bay would fetch at the Ore Market. */
export function cargoValue(cargo: Cargo): number {
  let total = 0;
  for (const entry of MINERALS) total += cargo[entry.id] * entry.value;
  return total;
}

// ---- The load's effect on flight ----------------------------------------

/** The load fraction: the weight in the bay over the tier's lift limit. */
export function loadFraction(cargo: Cargo, tiers: UpgradeTiers): number {
  return loadKg(cargo) / liftLimitKg(tiers);
}

/** True once the load meets the lift limit, at which point no climb is possible. */
export function overloaded(cargo: Cargo, tiers: UpgradeTiers): boolean {
  return loadFraction(cargo, tiers) >= 1;
}

/** The net upward acceleration the jetpack produces at the current load. */
export function climbAccel(cargo: Cargo, tiers: UpgradeTiers): number {
  return (
    jetpackRung(tiers).emptyAccel * Math.max(0, 1 - loadFraction(cargo, tiers))
  );
}

/** The upward speed cap at the current load. */
export function climbCap(cargo: Cargo, tiers: UpgradeTiers): number {
  const empty = jetpackRung(tiers).emptyClimb;
  const load = Math.min(1, loadFraction(cargo, tiers));
  return empty * (1 - (1 - CLIMB_CAP_FLOOR) * load);
}

/** The terminal fall speed at the current load. */
export function fallTerminal(cargo: Cargo, tiers: UpgradeTiers): number {
  const load = Math.min(1, loadFraction(cargo, tiers));
  return (
    FALL_TERMINAL_EMPTY + (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) * load
  );
}

// ---- Where the miner is --------------------------------------------------

/** The miner's depth in meters, read off its feet. */
export function depthMeters(miner: Miner): number {
  return Math.max(0, ((miner.y + MINER_H - SURFACE_Y) / TILE) * METERS_PER_ROW);
}

/** Whether the miner is at or above the camp ground. */
export function atSurface(miner: Miner): boolean {
  return rowAtY(miner.y + MINER_H / 2) <= SURFACE_ROW;
}
