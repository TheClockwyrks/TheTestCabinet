// Deepcore — the six field supplies, and jettisoning the Core Sample
// (specs/items.md).
//
// A supply is bought with Credits at the Supply Depot and carried as a count per
// type; using one consumes one. Both paths that use a supply, the number-key
// hotkeys and the inventory's USE control, run this module. The explosives reuse
// the blast in `src/hazards.ts` and the jettisoned Sample reuses its detonation.

import {
  CUES,
  DYNAMITE_RADIUS,
  EMERGENCY_FUEL,
  MINER_H,
  MINER_W,
  NANOBOT_HULL,
  PLASTIC_EXPLOSIVES_RADIUS,
  SPAWN_COL,
  SURFACE_Y,
  TELEPORT_HEIGHT_TILES_MAX,
  TELEPORT_HEIGHT_TILES_MIN,
  TELEPORT_SPEED_MAX,
  TELEPORT_SPEED_MIN,
  TILE,
} from "./constants";
import type { ItemId } from "./constants";
import { cue } from "./audio";
import { fx, note } from "./feedback";
import { maxFuel, maxHull } from "./figures";
import { detonateBlast, detonateGroundCore } from "./hazards";
import { triggerDeath } from "./modes";
import { minerCenterX, minerCenterY, minerCol, minerRow } from "./physics";
import { recenterCamera } from "./camera";
import { ITEM_BY_ID } from "./tuning";
import { colCenterX } from "./world";
import type { DeepcoreState } from "./game";

/** Buy one supply, deducting its price and incrementing the count. */
export function buyItem(d: DeepcoreState, id: ItemId): boolean {
  const def = ITEM_BY_ID[id];
  if (d.credits < def.price) {
    note(d, "NOT ENOUGH CREDITS");
    return false;
  }
  d.credits -= def.price;
  d.items[id] += 1;
  cue(d, CUES.fabricate);
  note(d, `BOUGHT ${def.name.toUpperCase()}`);
  return true;
}

/**
 * Use one supply. Holding none of it, or using one that would change nothing,
 * shows a note and consumes nothing.
 */
export function useItem(d: DeepcoreState, id: ItemId): boolean {
  if (d.screen !== "in-mine" || d.dying || d.launchAnim !== null) return false;
  if (d.items[id] <= 0) {
    note(d, `NO ${ITEM_BY_ID[id].name.toUpperCase()}`);
    return false;
  }
  const applied = applyItem(d, id);
  if (applied) d.items[id] -= 1;
  return applied;
}

function applyItem(d: DeepcoreState, id: ItemId): boolean {
  switch (id) {
    case "dynamite":
      return blast(d, DYNAMITE_RADIUS);
    case "plastic-explosives":
      return blast(d, PLASTIC_EXPLOSIVES_RADIUS);
    case "quantum-teleporter":
      return quantumWarp(d);
    case "matter-transmitter":
      return matterWarp(d);
    case "nanobots":
      return healHull(d);
    case "emergency-fuel":
      return refuel(d);
    default:
      return false;
  }
}

/** Clear the square block around the miner's cell. */
function blast(d: DeepcoreState, radius: number): boolean {
  d.miner.drilling = null;
  detonateBlast(d, minerCol(d.miner), minerRow(d.miner), radius);
  return true;
}

/**
 * Place the miner above the camp at a random height and downward speed, and let
 * the ordinary physics carry it down. These two draws are a live player action,
 * so they are taken off the page's own randomness rather than the seeded
 * generator (specs/instrumentation.md).
 */
function quantumWarp(d: DeepcoreState): boolean {
  const m = d.miner;
  const tiles =
    TELEPORT_HEIGHT_TILES_MIN +
    Math.random() * (TELEPORT_HEIGHT_TILES_MAX - TELEPORT_HEIGHT_TILES_MIN);
  m.x = colCenterX(SPAWN_COL, MINER_W);
  m.y = SURFACE_Y - MINER_H - tiles * TILE;
  m.vx = 0;
  m.vy =
    TELEPORT_SPEED_MIN +
    Math.random() * (TELEPORT_SPEED_MAX - TELEPORT_SPEED_MIN);
  m.facing = "east";
  m.state = "fall";
  m.drilling = null;
  fx(d, "core-extract", minerCenterX(m), minerCenterY(m));
  cue(d, CUES.impact);
  recenterCamera(d);
  note(d, "QUANTUM JUMP — BRACE FOR LANDING");
  return true;
}

/** Place the miner standing on the camp ground at zero velocity, with no impact. */
function matterWarp(d: DeepcoreState): boolean {
  const m = d.miner;
  m.x = colCenterX(SPAWN_COL, MINER_W);
  m.y = SURFACE_Y - MINER_H;
  m.vx = 0;
  m.vy = 0;
  m.facing = "east";
  m.state = "idle";
  m.drilling = null;
  fx(d, "material-shimmer", minerCenterX(m), minerCenterY(m));
  cue(d, CUES.materialChime);
  recenterCamera(d);
  note(d, "MATTER TRANSMIT — SAFE AT CAMP");
  return true;
}

/** Repair `NANOBOT_HULL` hull, capped at the maximum. */
function healHull(d: DeepcoreState): boolean {
  if (d.miner.hull >= maxHull(d.tiers)) {
    note(d, "HULL ALREADY FULL");
    return false;
  }
  d.miner.hull = Math.min(maxHull(d.tiers), d.miner.hull + NANOBOT_HULL);
  fx(d, "material-shimmer", minerCenterX(d.miner), minerCenterY(d.miner));
  cue(d, CUES.fabricate);
  note(d, "HULL REPAIRED");
  return true;
}

/** Add `EMERGENCY_FUEL` fuel, capped at the maximum. */
function refuel(d: DeepcoreState): boolean {
  if (d.miner.fuel >= maxFuel(d.tiers)) {
    note(d, "FUEL ALREADY FULL");
    return false;
  }
  d.miner.fuel = Math.min(maxFuel(d.tiers), d.miner.fuel + EMERGENCY_FUEL);
  fx(d, "material-shimmer", minerCenterX(d.miner), minerCenterY(d.miner));
  cue(d, CUES.fabricate);
  note(d, "FUEL TOPPED UP");
  return true;
}

/** The jettisoned Core Sample, or `null`. */
export function coreGround(d: {
  groundItems: readonly { kind: string; col: number; row: number }[];
}): { col: number; row: number } | null {
  const item = d.groundItems.find((entry) => entry.kind === "core-sample");
  return item ? { col: item.col, row: item.row } : null;
}

/**
 * Drop the carried Core Sample onto the miner's cell. It cannot be picked back
 * up (specs/items.md).
 */
export function jettisonCoreSample(d: DeepcoreState): boolean {
  if (d.screen !== "in-mine" || d.dying || d.launchAnim !== null) return false;
  if (!d.satchel.coreSample) {
    note(d, "NO CORE SAMPLE CARRIED");
    return false;
  }
  d.satchel.coreSample = false;
  d.groundItems.push({
    kind: "core-sample",
    col: minerCol(d.miner),
    row: minerRow(d.miner),
  });
  fx(d, "core-extract", minerCenterX(d.miner), minerCenterY(d.miner));
  cue(d, CUES.impact);
  note(d, "CORE SAMPLE JETTISONED — CLEAR THE BLAST");
  return true;
}

/**
 * The Core Sample's timer reached zero. Carried, it kills the miner outright.
 * Jettisoned, it detonates where it lies and kills only a miner within its
 * blast. The Sample is destroyed either way.
 */
export function expireCoreTimer(d: DeepcoreState): void {
  if (d.satchel.coreSample) {
    triggerDeath(d, "core-detonation");
    return;
  }
  const ground = coreGround(d);
  if (!ground) {
    d.coreTimer = null;
    return;
  }
  const caught = detonateGroundCore(d, ground.col, ground.row);
  d.groundItems = d.groundItems.filter(
    (item) => !(item.col === ground.col && item.row === ground.row),
  );
  d.coreTimer = null;
  if (caught) triggerDeath(d, "core-detonation");
  else note(d, "CORE SAMPLE DETONATED — RETURN TO THE CORE FOR ANOTHER");
}
