// Meltdown — a tower's and a unit's live figures.
//
// Everything here is derived: the level scaling of specs/towers.md, the damage
// curve of specs/heat.md, the refund rule of specs/building.md, and the slow of
// specs/combat.md, each read off `src/constants.ts` and the entity's own state.
// Nothing here is stored, which is why the snapshot can report all of it and
// `setTowerLevel` needs no companion setter for any of it.

import {
  BLOOM_SPLASH,
  MAX_LEVEL,
  REFUND_RATE,
  RIME_SLOW_CEIL,
  SURGE_DEFS,
  TILE,
  TOWER_DEFS,
  emitterStats,
  footprintCentre,
  heatMultiplier,
  moverOutput,
  upgradeCost,
  type EmitterDef,
  type SurgeType,
  type TowerType,
} from "./constants";
import { sizeOf } from "./geometry";
import type { TowerState, UnitState } from "./game";

/** An emitter's live figures at its current level, or `null` for a mover. */
export function emitterOf(tower: Pick<TowerState, "type" | "level">): {
  def: EmitterDef;
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
} | null {
  const def = TOWER_DEFS[tower.type];
  if (def.kind !== "emitter") return null;
  return { def, ...emitterStats(def, tower.level) };
}

/** The tower's redline, which no upgrade changes. `0` for a mover. */
export function redlineOf(type: TowerType): number {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? def.redline : 0;
}

/** The tower's thermal mass, which divides every change to its heat. */
export function massOf(type: TowerType): number {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? def.mass : 1;
}

/** The stage point range is measured from, and a tower's own position. */
export function towerCentre(tower: Pick<TowerState, "type" | "col" | "row">): {
  x: number;
  y: number;
} {
  return footprintCentre(tower.col, tower.row, sizeOf(tower.type));
}

/** The live heat multiplier, and `0` for the Forge and the Sink. */
export function heatMultOf(
  tower: Pick<TowerState, "type" | "level" | "heat">,
): number {
  const def = TOWER_DEFS[tower.type];
  if (def.kind !== "emitter") return 0;
  return heatMultiplier(tower.heat, def.redline);
}

/** The live per-shot damage, and `0` for the Forge and the Sink. */
export function damageOf(
  tower: Pick<TowerState, "type" | "level" | "heat">,
): number {
  const live = emitterOf(tower);
  if (!live) return 0;
  return live.baseDamage * heatMultOf(tower);
}

/** A Rime's live slow fraction at its heat and level, and `0` elsewhere. */
export function slowFactorOf(
  tower: Pick<TowerState, "type" | "level" | "heat">,
): number {
  if (tower.type !== "rime") return 0;
  const ceiling = RIME_SLOW_CEIL[tower.level - 1];
  return ceiling * (1 - tower.heat / 100);
}

/** A mover's figure at its level: the Forge's setpoint, the Sink's output. */
export function outputOf(tower: Pick<TowerState, "type" | "level">): number {
  if (tower.type !== "forge" && tower.type !== "sink") return 0;
  return moverOutput(tower.type, tower.level);
}

/** What the next upgrade costs this tower, and `0` at `MAX_LEVEL`. */
export function upgradeCostOf(
  tower: Pick<TowerState, "type" | "level">,
): number {
  return upgradeCost(TOWER_DEFS[tower.type], tower.level);
}

/** Whether this tower can still be upgraded at all. */
export function upgradable(tower: Pick<TowerState, "level">): boolean {
  return tower.level < MAX_LEVEL;
}

/** What selling this tower pays right now (specs/building.md, Selling). */
export function refundOf(tower: Pick<TowerState, "spent" | "fresh">): number {
  return tower.fresh ? tower.spent : Math.floor(REFUND_RATE * tower.spent);
}

/** The tower's build cost. */
export function costOf(type: TowerType): number {
  return TOWER_DEFS[type].cost;
}

/** A unit's unslowed speed, in logical units per second. */
export function baseSpeedOf(type: SurgeType): number {
  return SURGE_DEFS[type].speed;
}

/** A unit's current speed, with any live slow taken off. */
export function speedOf(unit: Pick<UnitState, "type" | "slowFactor">): number {
  return baseSpeedOf(unit.type) * (1 - unit.slowFactor);
}

/** Whether a slow touches this type at all. */
export function slowable(type: SurgeType): boolean {
  return SURGE_DEFS[type].slowable;
}

/** Whether this type ignores the maze and flies. */
export function flying(type: SurgeType): boolean {
  return SURGE_DEFS[type].flies;
}

/** The Bloom's splash radius, in logical units. */
export const SPLASH_RADIUS = BLOOM_SPLASH * TILE;
