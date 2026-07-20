// Deepcore — single-use FIELD SUPPLIES and the Core Sample jettison / ground item
// (specs/items.md).
//
// Six consumable items are bought with Credits at the Supply Depot building (the fourth
// Credits sink, specs/flow.md) and carried as a count per type; each use consumes one.
// This module owns buying (the economy.ts spend pattern), using (the
// hotkeys 1–6 and the inventory USE buttons both route here), and the location-aware
// expiry of the Core Sample timer once it has been jettisoned as a ground item. The
// explosives reuse hazards.ts's blast/gas-chain; the ground detonation reuses the core
// detonation. Item effects with random variation (the Quantum Teleporter) may use
// Math.random — item use is a live player action, not part of the deterministic proof.

import {
  CORE_GROUND_BLAST_TILES,
  DYNAMITE_RADIUS,
  EMERGENCY_FUEL_AMOUNT,
  GRID_MARGIN_X,
  ITEM_BY_ID,
  ITEMS,
  NANOBOTS_HEAL,
  PLASTIC_RADIUS,
  QUANTUM_DROP_MAX_TILES,
  QUANTUM_DROP_MIN_TILES,
  QUANTUM_VEL_MAX,
  QUANTUM_VEL_MIN,
  TILE_SIZE,
} from "./constants";
import { detonateBlast } from "./hazards";
import { triggerDeath } from "./modes";
import {
  MINER_H,
  MINER_W,
  SURFACE_FEET_Y,
  minerCenterX,
  minerCenterY,
  minerCol,
  minerRow,
} from "./physics";
import { tileLeft, tileTop } from "./world";
import type { ItemCounts, ItemId } from "./types";
import type { Game } from "./game";

/** Fresh, empty item counts (all six at 0). */
export function emptyItems(): ItemCounts {
  return {
    dynamite: 0,
    "plastic-explosives": 0,
    "quantum-teleporter": 0,
    "matter-transmitter": 0,
    nanobots: 0,
    "emergency-fuel": 0,
  };
}

/** The item bound to a number-key hotkey (1..6), or null if none. */
export function itemForHotkey(n: number): ItemId | null {
  const def = ITEMS.find((i) => i.hotkey === n);
  return def ? def.id : null;
}

// ---------------------------------------------------------------------------
// Buying (Supply Depot) — the fourth Credits sink (specs/flow.md)
// ---------------------------------------------------------------------------

/** Buy one of `id` if affordable, deducting its price and incrementing the count. */
export function buyItem(game: Game, id: ItemId): boolean {
  const def = ITEM_BY_ID[id];
  if (game.credits < def.price) return false;
  game.credits -= def.price;
  game.items[id]++;
  game.sndQueue.push("fabricate");
  game.note(`BOUGHT ${def.label.toUpperCase()}`);
  return true;
}

// ---------------------------------------------------------------------------
// Using (hotkeys 1–6 + inventory USE) — both paths call this (specs/items.md)
// ---------------------------------------------------------------------------

/**
 * Use one held item. A no-op (with a note) when the miner holds zero of it or it cannot
 * apply (e.g. Nanobots at full hull); otherwise the effect fires and one is consumed.
 * Only valid during live in-mine play (not on menus, while dying, or during launch); the
 * inventory overlay is fine (the world is frozen but the effect still resolves).
 */
export function useItem(game: Game, id: ItemId): boolean {
  if (game.phase !== "in-mine" || game.dying || game.launchAnim !== null) return false;
  if ((game.items[id] ?? 0) <= 0) {
    game.note(`NO ${ITEM_BY_ID[id].label.toUpperCase()}`);
    return false;
  }
  const applied = applyItem(game, id);
  if (applied) game.items[id]--;
  return applied;
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

/** Dynamite / Plastic Explosives — clear the block centered on the miner (specs/items.md). */
function blast(game: Game, radius: number): boolean {
  game.miner.drilling = null;
  detonateBlast(game, minerCol(game.miner), minerRow(game.miner), radius);
  return true;
}

/**
 * Quantum Teleporter — drop the miner in ABOVE the camp floor at a randomized height and
 * a randomized DOWNWARD velocity, then let normal physics carry it down: a bad roll slams
 * it into the floor at speed and the normal fall-impact (specs/hazards.md) applies, which
 * can kill a low-hull miner. Cheap and risky (specs/items.md).
 */
function quantumWarp(game: Game): boolean {
  const m = game.miner;
  const dropTiles = QUANTUM_DROP_MIN_TILES + Math.random() * (QUANTUM_DROP_MAX_TILES - QUANTUM_DROP_MIN_TILES);
  const vy = QUANTUM_VEL_MIN + Math.random() * (QUANTUM_VEL_MAX - QUANTUM_VEL_MIN);
  m.x = GRID_MARGIN_X + game.spawnCol * TILE_SIZE + (TILE_SIZE - MINER_W) / 2;
  m.y = SURFACE_FEET_Y - MINER_H - dropTiles * TILE_SIZE;
  m.vx = 0;
  m.vy = vy; // randomized downward velocity — physics + gravity do the rest
  m.facing = "east";
  m.state = "fall";
  m.drilling = null;
  game.fxQueue.push({ kind: "core-extract", x: minerCenterX(m), y: minerCenterY(m) });
  game.sndQueue.push("impact");
  game.updateCamera(1);
  game.note("QUANTUM JUMP — BRACE FOR LANDING");
  return true;
}

/**
 * Matter Transmitter — warp the miner SAFELY to the surface, standing on the camp floor at
 * zero velocity with no impact (a clean surfacing). A premium guaranteed escape, far
 * pricier than the Quantum Teleporter (specs/items.md).
 */
function matterWarp(game: Game): boolean {
  game.placeMinerAtSurface();
  game.fxQueue.push({ kind: "material-shimmer", x: minerCenterX(game.miner), y: minerCenterY(game.miner) });
  game.sndQueue.push("material-chime");
  game.updateCamera(1);
  game.note("MATTER TRANSMIT — SAFE AT CAMP");
  return true;
}

/** Regenerative Nanobots — repair a fixed amount of hull, capped at max (specs/items.md). */
function healHull(game: Game): boolean {
  if (game.miner.hull >= game.maxHull()) {
    game.note("HULL ALREADY FULL");
    return false;
  }
  game.miner.hull = Math.min(game.maxHull(), game.miner.hull + NANOBOTS_HEAL);
  game.fxQueue.push({ kind: "material-shimmer", x: minerCenterX(game.miner), y: minerCenterY(game.miner) });
  game.sndQueue.push("fabricate");
  game.note("HULL REPAIRED");
  return true;
}

/** Emergency Fuel — refuel a fixed amount, capped at max (specs/items.md). */
function refuel(game: Game): boolean {
  if (game.miner.fuel >= game.maxFuel()) {
    game.note("FUEL ALREADY FULL");
    return false;
  }
  game.miner.fuel = Math.min(game.maxFuel(), game.miner.fuel + EMERGENCY_FUEL_AMOUNT);
  game.fxQueue.push({ kind: "material-shimmer", x: minerCenterX(game.miner), y: minerCenterY(game.miner) });
  game.sndQueue.push("fabricate");
  game.note("FUEL TOPPED UP");
  return true;
}

// ---------------------------------------------------------------------------
// Location-aware Core Sample timer expiry (specs/items.md, specs/hazards.md)
// ---------------------------------------------------------------------------

/**
 * The Core Sample timer reached 0. While CARRIED it kills the miner outright (as today).
 * While JETTISONED it detonates AT its ground location — a big produced core-detonation
 * VFX either way — but its lethal blast only reaches a miner within CORE_GROUND_BLAST_TILES;
 * a miner who fled far enough SURVIVES, and the Sample is destroyed (return to the Core for
 * a fresh one). Called from game.fixedStep when coreTimer hits 0.
 */
export function expireCoreTimer(game: Game): void {
  if (game.satchel.coreSample) {
    triggerDeath(game, "core-detonation");
    return;
  }
  const g = game.coreGround();
  if (!g) {
    game.coreTimer = null;
    return;
  }
  const bx = tileLeft(g.col) + TILE_SIZE / 2;
  const by = tileTop(g.row) + TILE_SIZE / 2;
  game.fxQueue.push({ kind: "core-detonation", x: bx, y: by });
  game.sndQueue.push("gas-explosion");
  game.addShake(18, 0.6); // a much bigger, longer shake than a gas pocket (specs/hazards.md)
  const dist = Math.hypot(minerCenterX(game.miner) - bx, minerCenterY(game.miner) - by);
  // The jettisoned Sample is destroyed and its timer ends regardless of the outcome.
  game.groundItems = game.groundItems.filter((x) => x !== g);
  game.coreTimer = null;
  if (dist <= CORE_GROUND_BLAST_TILES * TILE_SIZE) {
    triggerDeath(game, "core-detonation");
  } else {
    game.note("CORE SAMPLE DETONATED — RETURN TO THE CORE FOR ANOTHER");
  }
}
