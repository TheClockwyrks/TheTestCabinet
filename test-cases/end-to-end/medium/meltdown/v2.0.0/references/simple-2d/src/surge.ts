// Meltdown — the surge: how a unit crosses the floor, and what leaving costs.
//
// A ground unit walks between tile centres along the cheapest route
// `src/routes.ts` computes; a flyer ignores the maze entirely and travels the
// straight line from where it entered to the midpoint of its assigned
// exhaust's opening (specs/mazing.md). Both leave the floor under one rule: the
// tile their centre occupies is one of that exhaust's opening tiles.
//
// A unit's route is recomputed from the tile it stands on every frame, so a
// wall dropped across its way changes `remaining` on the frame the wall lands
// and moves the unit not at all.

import { SURGE_DEFS, TILE, tileCX, tileCY } from "./constants";
import {
  exhaustMidpoint,
  exhaustOf,
  isExhaustTile,
  tileAt,
  ventTiles,
} from "./geometry";
import { fieldFor, nextStep, type Routes } from "./routes";
import { baseSpeedOf, flying } from "./stats";
import { tileIndex } from "./geometry";
import type { SurgeType, VentName } from "./constants";
import type { UnitState } from "./game";

/** The slack every countdown comparison carries; see `src/combat.ts`. */
const EPS = 1e-9;

/** The route length a unit still has to travel, in tiles. */
export function remainingOf(
  unit: Pick<UnitState, "type" | "x" | "y" | "vent">,
  routes: Routes,
): number {
  const exhaust = exhaustOf(unit.vent);
  if (flying(unit.type)) {
    const target = exhaustMidpoint(exhaust);
    return Math.hypot(target.x - unit.x, target.y - unit.y) / TILE;
  }
  const tile = tileAt(unit.x, unit.y);
  const field = fieldFor(routes, exhaust);
  const index = tileIndex(tile.col, tile.row);
  if (index < 0 || index >= field.length) return Infinity;
  return field[index];
}

/** The opening tile a unit entering at `vent` appears on, or `null` if the
 * vent is walled shut. */
export function entryTile(
  vent: VentName,
  routes: Routes,
): { col: number; row: number } | null {
  for (const tile of ventTiles(vent)) {
    if (routes.blocked[tileIndex(tile.col, tile.row)] === 0) return tile;
  }
  return null;
}

/**
 * A unit of `type` entering at `vent`, at full hp for the scaling it is
 * released under. Its centre appears on the centre of an open opening tile of
 * that vent (specs/surge.md, Entering the floor).
 */
export function newUnit(
  id: number,
  type: SurgeType,
  vent: VentName,
  hpScale: number,
  routes: Routes,
): UnitState {
  const tile = entryTile(vent, routes) ?? ventTiles(vent)[0];
  const maxHp = SURGE_DEFS[type].hp * hpScale;
  return {
    id,
    type,
    x: tileCX(tile.col),
    y: tileCY(tile.row),
    hp: maxHp,
    maxHp,
    slowFactor: 0,
    slowTimer: 0,
    vent,
    motion: true,
  };
}

/** What one frame of movement and leaving left behind. */
export interface SurgeFrame {
  readonly surge: UnitState[];
  /** The lives every unit that reached its exhaust this frame cost. */
  readonly livesLost: number;
  readonly leaked: boolean;
}

/**
 * One frame of the surge: slow timers count down, every unit whose locomotion
 * is not held travels, and every unit standing on its assigned exhaust leaves.
 */
export function stepSurge(
  surge: readonly UnitState[],
  routes: Routes,
  dt: number,
): SurgeFrame {
  const next: UnitState[] = [];
  let livesLost = 0;
  let leaked = false;
  for (const unit of surge) {
    const slowTimer = unit.slowTimer > 0 ? unit.slowTimer - dt : 0;
    const expired = slowTimer <= EPS;
    const moved: UnitState = {
      ...unit,
      slowTimer: expired ? 0 : slowTimer,
      slowFactor: expired ? 0 : unit.slowFactor,
    };
    const speed = baseSpeedOf(moved.type) * (1 - moved.slowFactor);
    const travelled = moved.motion ? travel(moved, routes, speed * dt) : moved;
    const exhaust = exhaustOf(travelled.vent);
    const tile = tileAt(travelled.x, travelled.y);
    if (isExhaustTile(exhaust, tile.col, tile.row)) {
      livesLost += SURGE_DEFS[travelled.type].leak;
      leaked = true;
      continue;
    }
    next.push(travelled);
  }
  return { surge: next, livesLost, leaked };
}

/** How many tile-to-tile hops one frame may resolve before it gives up. */
const MAX_HOPS = 64;

/** Move one unit `budget` logical units along its route or its flight line. */
function travel(unit: UnitState, routes: Routes, budget: number): UnitState {
  if (budget <= 0) return unit;
  const exhaust = exhaustOf(unit.vent);
  if (flying(unit.type)) {
    const target = exhaustMidpoint(exhaust);
    return advance(unit, target.x, target.y, budget);
  }
  let moving = unit;
  let left = budget;
  for (let hop = 0; hop < MAX_HOPS && left > 0; hop += 1) {
    const tile = tileAt(moving.x, moving.y);
    if (isExhaustTile(exhaust, tile.col, tile.row)) break;
    const step = nextStep(routes, exhaust, tile.col, tile.row);
    if (!step) break;
    const tx = tileCX(step.col);
    const ty = tileCY(step.row);
    const distance = Math.hypot(tx - moving.x, ty - moving.y);
    if (distance <= left) {
      moving = { ...moving, x: tx, y: ty };
      left -= distance;
    } else {
      moving = advance(moving, tx, ty, left);
      left = 0;
    }
  }
  return moving;
}

/** Move a unit at most `budget` units toward `(tx, ty)`. */
function advance(
  unit: UnitState,
  tx: number,
  ty: number,
  budget: number,
): UnitState {
  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= budget || distance === 0) {
    return { ...unit, x: tx, y: ty };
  }
  return {
    ...unit,
    x: unit.x + (dx / distance) * budget,
    y: unit.y + (dy / distance) * budget,
  };
}
