// Deepcore — the Credits economy (specs/mining.md, specs/flow.md, specs/upgrades.md).
//
// One source (selling ore at the Ore Market) and two sinks (upgrades, rocket parts).
// Credits are banked and never go negative; an action you cannot afford is disabled.
// This module owns cargo accounting, selling, and buying the five upgrade tracks; the
// rocket sink lives in rocket.ts.

import { CARGO_CAPACITY, MAX_TIER, ORES, UPGRADE_TRACKS } from "./constants";
import type { Cargo, Ore, UpgradeTrack } from "./types";
import type { Game } from "./game";

/** Total units currently in the cargo bay. */
export function cargoUsed(cargo: Cargo): number {
  let n = 0;
  for (const o of Object.keys(cargo) as Ore[]) n += cargo[o];
  return n;
}

/** Value the current cargo would fetch at the Ore Market. */
export function cargoValue(cargo: Cargo): number {
  let total = 0;
  for (const o of Object.keys(cargo) as Ore[]) total += cargo[o] * ORES[o].value;
  return total;
}

/** Try to add one unit of ore to cargo; false if the bay is full (specs/mining.md). */
export function collectOre(game: Game, ore: Ore): boolean {
  if (cargoUsed(game.cargo) >= game.cargoCap()) return false;
  game.cargo[ore]++;
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
