// Meltdown — everything derived from a tower rather than stored on one.
//
// A tower's record carries only what cannot be recomputed: its type, its tile,
// its rotation, its level, its heat, its tallies and its gates. Its size, range,
// damage, redline, refund, upgrade cost, world radiator faces and live multiplier
// all follow from those, so they live here as reads and the snapshot reports what
// this file returns (specs/towers.md, specs/building.md).

import {
  REFUND_RATE,
  TILE,
  footprintCentre,
  heatMultiplier,
  inBounds,
  tileOfX,
  tileOfY,
} from "./constants";
import {
  TOWER_DEFS,
  emitterStats,
  isEmitter,
  moverOutput,
  upgradeCost as upgradeCostOf,
  type EmitterDef,
  type EmitterStats,
  type MoverDef,
  type TowerDef,
} from "./defs";
import { footprintTiles, idx, type Floor } from "./grid";
import type { Tower } from "./state";
import { SIDES, type Rotation, type Side, type TowerType } from "./types";

/** The roster entry behind a tower. */
export function defOf(tower: Tower): TowerDef {
  return TOWER_DEFS[tower.type];
}

/** A tower's footprint side, in tiles. */
export function sizeOf(tower: Tower): number {
  return TOWER_DEFS[tower.type].size;
}

/** Whether this tower fires, carries heat, and can trip. */
export function isEmitterTower(tower: Tower): boolean {
  return isEmitter(TOWER_DEFS[tower.type]);
}

/** The emitter definition behind a tower, or `null` for a mover. */
export function emitterDef(tower: Tower): EmitterDef | null {
  const def = TOWER_DEFS[tower.type];
  return isEmitter(def) ? def : null;
}

/** The mover definition behind a tower, or `null` for an emitter. */
export function moverDef(tower: Tower): MoverDef | null {
  const def = TOWER_DEFS[tower.type];
  return isEmitter(def) ? null : def;
}

/** An emitter's figures at its current level, or `null` for a mover. */
export function statsOf(tower: Tower): EmitterStats | null {
  const def = emitterDef(tower);
  return def === null ? null : emitterStats(def, tower.level);
}

/** The footprint's centre: the point range is measured from. */
export function centreOf(tower: Tower): { x: number; y: number } {
  return footprintCentre(tower.col, tower.row, sizeOf(tower));
}

/** Every tile a tower covers. */
export function tilesOf(tower: Tower): number[] {
  return footprintTiles(tower.col, tower.row, sizeOf(tower));
}

/**
 * A local face turned into the world face it points at after `rotation`.
 *
 * Rotation turns the faces in the order `N -> E -> S -> W`, one step per
 * rotation (specs/towers.md).
 */
export function worldSide(local: Side, rotation: Rotation): Side {
  return SIDES[(SIDES.indexOf(local) + rotation) % SIDES.length];
}

/**
 * A tower's radiator faces, in world orientation. Empty for the Forge and the
 * Sink, which have no radiator faces at any rotation.
 */
export function radiatorFaces(tower: Tower): Side[] {
  const def = emitterDef(tower);
  if (def === null) return [];
  return def.radiators.map((local) => worldSide(local, tower.rotation));
}

/** Whether a world face of this tower is a radiator face. */
export function isRadiatorFace(tower: Tower, side: Side): boolean {
  return radiatorFaces(tower).includes(side);
}

/** The live damage multiplier this tower's heat gives it; `0` for a mover. */
export function heatMultOf(tower: Tower): number {
  const stats = statsOf(tower);
  return stats === null ? 0 : heatMultiplier(tower.heat, stats.redline);
}

/** The per-shot damage this tower removes right now; `0` for a mover. */
export function damageOf(tower: Tower): number {
  const stats = statsOf(tower);
  return stats === null ? 0 : stats.baseDamage * heatMultOf(tower);
}

/** The Rime's live slow fraction; `0` on every other tower. */
export function slowFactorOf(tower: Tower): number {
  const stats = statsOf(tower);
  if (stats === null || stats.slowCeil === 0) return 0;
  return stats.slowCeil * (1 - tower.heat / 100);
}

/** The Forge's setpoint or the Sink's per-edge cooling; `0` for an emitter. */
export function outputOf(tower: Tower): number {
  const def = moverDef(tower);
  return def === null ? 0 : moverOutput(def, tower.level);
}

/** This tower's redline; `0` for a mover, which carries no heat. */
export function redlineOf(tower: Tower): number {
  const stats = statsOf(tower);
  return stats === null ? 0 : stats.redline;
}

/** What it costs to take this tower one level up; `0` at the ceiling. */
export function upgradeCostOfTower(tower: Tower): number {
  return upgradeCostOf(defOf(tower), tower.level);
}

/** What selling this tower pays right now (specs/building.md). */
export function refundOf(tower: Tower): number {
  return tower.fresh ? tower.spent : Math.floor(REFUND_RATE * tower.spent);
}

/** How far this tower reaches, in logical units. */
export function rangeUnits(tower: Tower): number {
  const stats = statsOf(tower);
  return stats === null ? 0 : stats.range * TILE;
}

/** Build one tower at level I, cold, online, fresh, with both faculties on. */
export function createTower(
  id: number,
  type: TowerType,
  col: number,
  row: number,
  rotation: Rotation,
): Tower {
  return {
    id,
    type,
    col,
    row,
    rotation,
    level: 1,
    heat: 0,
    tripped: false,
    tripTimer: 0,
    fireAcc: 0,
    targeting: null,
    firing: false,
    kills: 0,
    damageDealt: 0,
    spent: TOWER_DEFS[type].cost,
    fresh: true,
    firingEnabled: true,
    thermalEnabled: true,
  };
}

/** The tower with that id, or `null`. */
export function towerById(
  towers: readonly Tower[],
  id: number | null,
): Tower | null {
  if (id === null) return null;
  return towers.find((tower) => tower.id === id) ?? null;
}

/** The tower covering a tile, or `null`. */
export function towerAtTile(
  towers: readonly Tower[],
  floor: Floor,
  c: number,
  r: number,
): Tower | null {
  if (!inBounds(c, r)) return null;
  const id = floor.owner[idx(c, r)];
  return id < 0 ? null : towerById(towers, id);
}

/** The tower whose footprint covers a stage position, or `null`. */
export function towerAtPoint(
  towers: readonly Tower[],
  floor: Floor,
  x: number,
  y: number,
): Tower | null {
  return towerAtTile(towers, floor, tileOfX(x), tileOfY(y));
}
