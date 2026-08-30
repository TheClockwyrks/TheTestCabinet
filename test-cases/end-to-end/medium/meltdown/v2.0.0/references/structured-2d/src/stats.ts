// Meltdown — a tower's and a unit's live figures.
//
// Everything a tower or a surge unit is worth right now is DERIVED from the
// declared state and the tables in `src/constants.ts`, never stored: the level
// alone decides a tower's range, rate, damage and per-shot heat
// (specs/towers.md, Levels), its heat alone decides its multiplier and a Rime's
// slow (specs/heat.md, specs/combat.md), and what has been spent on it and
// whether it is still fresh decide its refund (specs/building.md).
//
// Keeping them here rather than on `TowerState` is what makes the state the
// whole of the authoritative game: a snapshot, an inspector readout, a
// validator and the simulation all read one function and cannot disagree.

import {
  BLOOM_SPLASH,
  FORGE_SETPOINT,
  HUNDRED_HP_SCALE,
  REFUND_RATE,
  RIME_SLOW_CEIL,
  SINK_OUTPUT,
  SURGE_DEFS,
  TILE,
  TOWER_DEFS,
  emitterStats,
  footprintCentre,
  heatMultiplier,
  hpScale,
  upgradeCost,
  type EmitterDef,
  type Face,
  type ModeName,
  type SurgeType,
  type TowerType,
} from "./constants";
import { sizeOf, worldFaces } from "./geometry";
import type { TowerState, UnitState } from "./game";

/** An emitter's definition, or `null` for the Forge and the Sink. */
export function emitterDef(type: TowerType): EmitterDef | null {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? def : null;
}

/** An emitter's four level-scaled figures, all `0` for a mover. */
export function liveStats(tower: TowerState): {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
} {
  const def = emitterDef(tower.type);
  if (def === null) {
    return { range: 0, fireRate: 0, baseDamage: 0, heatPerShot: 0 };
  }
  return emitterStats(def, tower.level);
}

/** The heat this emitter reaches full power at; `0` for a mover. */
export function redlineOf(tower: TowerState): number {
  return emitterDef(tower.type)?.redline ?? 0;
}

/** The thermal mass that divides every change to this emitter's heat. */
export function massOf(tower: TowerState): number {
  return emitterDef(tower.type)?.mass ?? 0;
}

/** The live damage multiplier the tower's heat gives it; `0` for a mover. */
export function heatMultOf(tower: TowerState): number {
  const def = emitterDef(tower.type);
  if (def === null) return 0;
  return heatMultiplier(tower.heat, def.redline);
}

/** The damage one of this tower's shots removes right now; `0` for a mover. */
export function damageOf(tower: TowerState): number {
  const def = emitterDef(tower.type);
  if (def === null) return 0;
  return liveStats(tower).baseDamage * heatMultiplier(tower.heat, def.redline);
}

/** A Rime's cold slow ceiling at its level. */
export function slowCeilOf(tower: TowerState): number {
  if (tower.type !== "rime") return 0;
  return RIME_SLOW_CEIL[tower.level - 1];
}

/**
 * The fraction of speed a shot from this tower would remove right now:
 * `slowCeil * (1 - H / 100)` for a Rime, and `0` for every other tower
 * (specs/combat.md, The Rime's slow).
 */
export function slowFactorOf(tower: TowerState): number {
  if (tower.type !== "rime") return 0;
  return slowCeilOf(tower) * (1 - tower.heat / 100);
}

/** A Forge's setpoint or a Sink's per-edge output; `0` for an emitter. */
export function outputOf(tower: TowerState): number {
  if (tower.type === "forge") return FORGE_SETPOINT[tower.level - 1];
  if (tower.type === "sink") return SINK_OUTPUT[tower.level - 1];
  return 0;
}

/** What the next upgrade costs this tower, and `0` at `MAX_LEVEL`. */
export function upgradeCostOf(tower: TowerState): number {
  return upgradeCost(TOWER_DEFS[tower.type], tower.level);
}

/**
 * What selling this tower pays right now: everything spent on it while it is
 * still fresh, and `floor(0.7 * spent)` once it has faced a wave.
 */
export function refundOf(tower: TowerState): number {
  return tower.fresh ? tower.spent : Math.floor(REFUND_RATE * tower.spent);
}

/** The tower's radiator faces in world orientation; empty for a mover. */
export function worldRadiatorsOf(tower: TowerState): Face[] {
  const radiators: readonly Face[] = TOWER_DEFS[tower.type].radiators;
  return worldFaces(radiators, tower.rotation);
}

/** The tower's footprint centre, which is the point range is measured from. */
export function towerCentre(tower: TowerState): { x: number; y: number } {
  return footprintCentre(tower.col, tower.row, sizeOf(tower.type));
}

/** An emitter's range right now, in logical stage units. */
export function rangeUnits(tower: TowerState): number {
  return liveStats(tower).range * TILE;
}

/** The Bloom's splash radius, in logical stage units. */
export const SPLASH_UNITS = BLOOM_SPLASH * TILE;

/**
 * The hp factor a unit released now carries: The Hundred's flat factor in place
 * of the progression's per-wave scaling (specs/modes.md, The Hundred).
 */
export function hpFactor(mode: ModeName, wave: number): number {
  return mode === "hundred" ? HUNDRED_HP_SCALE : hpScale(wave);
}

/** A unit's unslowed speed. */
export function baseSpeedOf(type: SurgeType): number {
  return SURGE_DEFS[type].speed;
}

/** A unit's speed right now, its base reduced by any live slow. */
export function speedOf(unit: UnitState): number {
  return baseSpeedOf(unit.type) * (1 - unit.slowFactor);
}
