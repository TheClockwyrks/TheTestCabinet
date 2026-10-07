// Meltdown — everything derived from a surge unit rather than stored on one.
//
// A unit's record carries its type, its centre, its hp, its live slow, the vent
// it entered at, and its motion gate. Its exhaust, whether it flies, its base and
// current speed, the tile it stands on and its remaining route all follow from
// those (specs/surge.md, specs/mazing.md).

import {
  OPPOSITE,
  TILE,
  inBounds,
  tileCX,
  tileCY,
  tileOfX,
  tileOfY,
} from "./constants";
import { SURGE_DEFS } from "./defs";
import { OPENING_TILES, colOf, idx, rowOf, type Floor } from "./grid";
import type { Unit } from "./state";
import type { Exhaust, SurgeType, Vent } from "./types";

/** The exhaust a unit is assigned for its whole life. */
export function exhaustOf(unit: Unit): Exhaust {
  return OPPOSITE[unit.vent];
}

/** Whether this unit ignores the maze. */
export function fliesOf(unit: Unit): boolean {
  return SURGE_DEFS[unit.type].flies;
}

/** The unit's unslowed speed, in logical units per second. */
export function baseSpeedOf(unit: Unit): number {
  return SURGE_DEFS[unit.type].speed;
}

/** The unit's current speed, with any live slow taken off. */
export function speedOf(unit: Unit): number {
  return baseSpeedOf(unit) * (1 - unit.slowFactor);
}

/** The tile the unit's centre falls in; may be off the grid. */
export function tileOf(unit: Unit): { c: number; r: number } {
  return { c: tileOfX(unit.x), r: tileOfY(unit.y) };
}

/**
 * The point a flyer aims at: the midpoint of its exhaust opening's run of tile
 * centres (specs/mazing.md).
 */
export function exhaustPoint(exhaust: Exhaust): { x: number; y: number } {
  const tiles = OPENING_TILES[exhaust];
  const first = tiles[0];
  const last = tiles[tiles.length - 1];
  return {
    x: (tileCX(colOf(first)) + tileCX(colOf(last))) / 2,
    y: (tileCY(rowOf(first)) + tileCY(rowOf(last))) / 2,
  };
}

/**
 * The route length the unit still has to travel, in tiles.
 *
 * A walker reads its exhaust's distance field at the tile it stands on; a flyer
 * takes the straight line to its exhaust's centre, divided by the tile size.
 */
export function remainingOf(unit: Unit, floor: Floor): number {
  if (fliesOf(unit)) {
    const goal = exhaustPoint(exhaustOf(unit));
    return Math.hypot(goal.x - unit.x, goal.y - unit.y) / TILE;
  }
  const { c, r } = tileOf(unit);
  return floor.remainingFrom(exhaustOf(unit), c, r);
}

/** Whether the unit's centre stands on one of its exhaust's opening tiles. */
export function atExhaust(unit: Unit): boolean {
  const { c, r } = tileOf(unit);
  if (!inBounds(c, r)) return false;
  return OPENING_TILES[exhaustOf(unit)].includes(idx(c, r));
}

/**
 * The opening tile a unit entering at `vent` appears on.
 *
 * Only tiles no footprint covers are candidates, so a unit never appears on an
 * opening tile a footprint has covered, and the choice cycles with `spread` so a
 * wave arrives as a stream across the opening rather than a stack on one tile. It
 * is a pure function of the floor and that counter, so it takes nothing from the
 * generator (specs/surge.md).
 */
export function entryTile(floor: Floor, vent: Vent, spread: number): number {
  const open = floor.openOpeningTiles(vent);
  // Every tile of the opening covered is unreachable in play — the never-seal
  // rule keeps one open — but a posed floor can reach it, and a unit added
  // there still has to exist somewhere.
  const candidates = open.length > 0 ? open : OPENING_TILES[vent];
  const index =
    ((spread % candidates.length) + candidates.length) % candidates.length;
  return candidates[index];
}

/** Build one unit at `vent`, at full hp, with its motion on. */
export function createUnit(
  id: number,
  type: SurgeType,
  vent: Vent,
  floor: Floor,
  hpScale: number,
  spread: number,
): Unit {
  const tile = entryTile(floor, vent, spread);
  const maxHp = SURGE_DEFS[type].hp * hpScale;
  return {
    id,
    type,
    x: tileCX(colOf(tile)),
    y: tileCY(rowOf(tile)),
    hp: maxHp,
    maxHp,
    slowFactor: 0,
    slowTimer: 0,
    vent,
    motion: true,
  };
}

/** The unit with that id, or `null`. */
export function unitById(
  units: readonly Unit[],
  id: number | null,
): Unit | null {
  if (id === null) return null;
  return units.find((unit) => unit.id === id) ?? null;
}
