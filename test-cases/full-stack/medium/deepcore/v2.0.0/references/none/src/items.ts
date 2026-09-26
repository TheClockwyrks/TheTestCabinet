// Deepcore — the six field supplies, and jettisoning the Core Sample (specs/items.md).
//
// A supply is bought with Credits at the Supply Depot and carried as a count per type;
// using one consumes one. Both paths that use a supply, the number-key hotkeys and the
// inventory's USE control, run this module. The explosives reuse the blast in
// hazards.ts and the jettisoned Sample reuses its detonation.

import {
  DYNAMITE_RADIUS,
  EMERGENCY_FUEL,
  ITEMS,
  ITEM_BY_ID,
  ITEM_IDS,
  MINER_H,
  MINER_W,
  NANOBOT_HULL,
  PLASTIC_RADIUS,
  QUANTUM_DROP_MAX_TILES,
  QUANTUM_DROP_MIN_TILES,
  QUANTUM_VEL_MAX,
  QUANTUM_VEL_MIN,
  SPAWN_COL,
  SURFACE_Y,
  TILE,
} from "./constants";
import { detonateBlast, detonateGroundCore } from "./hazards";
import { triggerDeath } from "./modes";
import { minerCenterX, minerCenterY, minerCol, minerRow } from "./physics";
import { colCenterX } from "./world";
import type { ItemCounts, ItemId } from "./types";
import type { Game } from "./game";

/** No supplies held. */
export function emptyItems(): ItemCounts {
  const counts = {} as ItemCounts;
  for (const id of ITEM_IDS) counts[id] = 0;
  return counts;
}

/** The supply a number key uses, or null. */
export function itemForHotkey(n: number): ItemId | null {
  return ITEMS.find((i) => i.hotkey === n)?.id ?? null;
}

/** Buy one supply, deducting its price and incrementing the count. */
export function buyItem(game: Game, id: ItemId): boolean {
  const def = ITEM_BY_ID[id];
  if (game.credits < def.price) {
    game.note("NOT ENOUGH CREDITS");
    return false;
  }
  game.credits -= def.price;
  game.items[id]++;
  game.sndQueue.push("fabricate");
  game.note(`BOUGHT ${def.label.toUpperCase()}`);
  return true;
}

/**
 * Use one supply, from wherever the game stands.
 *
 * This is the transaction the hotkey and the inventory's `USE` control name, and
 * it is what the debug surface calls. Holding none of it, or using one that would
 * change nothing, shows a note and consumes nothing — those are the supply's own
 * rules. Whether the game is in live play is the player's route and lives in
 * `tryUseItem` (`specs/instrumentation.md`, The controls).
 */
export function performUseItem(game: Game, id: ItemId): boolean {
  if ((game.items[id] ?? 0) <= 0) {
    game.note(`NO ${ITEM_BY_ID[id].label.toUpperCase()}`);
    return false;
  }
  const applied = applyItem(game, id);
  if (applied) game.items[id]--;
  return applied;
}

/** The player's route to a supply: live play, then the transaction. */
export function useItem(game: Game, id: ItemId): boolean {
  if (game.screen !== "in-mine" || game.dying || game.launchAnim !== null)
    return false;
  return performUseItem(game, id);
}

function applyItem(game: Game, id: ItemId): boolean {
  switch (id) {
    case "dynamite":
      return blast(game, DYNAMITE_RADIUS);
    case "plastic-explosives":
      return blast(game, PLASTIC_RADIUS);
    case "quantum-teleporter":
      return quantumWarp(game);
    case "matter-transmitter":
      return matterWarp(game);
    case "nanobots":
      return healHull(game);
    case "emergency-fuel":
      return refuel(game);
    default:
      return false;
  }
}

/** Clear the square block around the miner's cell. */
function blast(game: Game, radius: number): boolean {
  game.miner.drilling = null;
  detonateBlast(game, minerCol(game.miner), minerRow(game.miner), radius);
  return true;
}

/**
 * Place the miner above the camp at a random height and downward speed, and let the
 * ordinary physics carry it down. Each draw is uniform over its stated bounds, and a
 * value the debug surface posed for it stands in for the draw and is consumed by it
 * (specs/instrumentation.md).
 */
function quantumWarp(game: Game): boolean {
  const m = game.miner;
  const tiles =
    game.nextTeleportHeight ??
    QUANTUM_DROP_MIN_TILES +
      Math.random() * (QUANTUM_DROP_MAX_TILES - QUANTUM_DROP_MIN_TILES);
  const speed =
    game.nextTeleportSpeed ??
    QUANTUM_VEL_MIN + Math.random() * (QUANTUM_VEL_MAX - QUANTUM_VEL_MIN);
  game.nextTeleportHeight = null;
  game.nextTeleportSpeed = null;
  m.x = colCenterX(SPAWN_COL, MINER_W);
  m.y = SURFACE_Y - MINER_H - tiles * TILE;
  m.vx = 0;
  m.vy = speed;
  m.facing = "east";
  m.state = "fall";
  m.drilling = null;
  game.fxQueue.push({
    kind: "core-extract",
    x: minerCenterX(m),
    y: minerCenterY(m),
  });
  game.sndQueue.push("impact");
  game.recenterCamera();
  game.note("QUANTUM JUMP — BRACE FOR LANDING");
  return true;
}

/** Place the miner standing on the camp ground at zero velocity, with no impact. */
function matterWarp(game: Game): boolean {
  game.placeMinerAtSpawn();
  game.fxQueue.push({
    kind: "material-shimmer",
    x: minerCenterX(game.miner),
    y: minerCenterY(game.miner),
  });
  game.sndQueue.push("material-chime");
  game.recenterCamera();
  game.note("MATTER TRANSMIT — SAFE AT CAMP");
  return true;
}

/** Repair NANOBOT_HULL hull, capped at the maximum. */
function healHull(game: Game): boolean {
  if (game.miner.hull >= game.maxHull()) {
    game.note("HULL ALREADY FULL");
    return false;
  }
  game.miner.hull = Math.min(game.maxHull(), game.miner.hull + NANOBOT_HULL);
  game.fxQueue.push({
    kind: "material-shimmer",
    x: minerCenterX(game.miner),
    y: minerCenterY(game.miner),
  });
  game.sndQueue.push("fabricate");
  game.note("HULL REPAIRED");
  return true;
}

/** Add EMERGENCY_FUEL fuel, capped at the maximum. */
function refuel(game: Game): boolean {
  if (game.miner.fuel >= game.maxFuel()) {
    game.note("FUEL ALREADY FULL");
    return false;
  }
  game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + EMERGENCY_FUEL);
  game.fxQueue.push({
    kind: "material-shimmer",
    x: minerCenterX(game.miner),
    y: minerCenterY(game.miner),
  });
  game.sndQueue.push("fabricate");
  game.note("FUEL TOPPED UP");
  return true;
}

/**
 * The Core Sample's timer reached zero. Carried, it kills the miner outright.
 * Jettisoned, it detonates where it lies and kills only a miner within its blast. The
 * Sample is destroyed either way.
 */
export function expireCoreTimer(game: Game): void {
  if (game.satchel.coreSample) {
    triggerDeath(game, "core-detonation");
    return;
  }
  const ground = game.coreGround();
  if (!ground) {
    game.coreTimer = null;
    return;
  }
  const caught = detonateGroundCore(game, ground.col, ground.row);
  game.groundItems = game.groundItems.filter((g) => g !== ground);
  game.coreTimer = null;
  if (caught) triggerDeath(game, "core-detonation");
  else game.note("CORE SAMPLE DETONATED — RETURN TO THE CORE FOR ANOTHER");
}
