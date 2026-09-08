// Meltdown — what a player does to a tower.
//
// specs/building.md fixes the preview's clamp, the six-part valid/invalid
// predicate, what placing costs and blocks, upgrading and its ceiling, and what
// selling pays and reopens. specs/mazing.md fixes the never-seal rule, which is
// the sixth part of that predicate and the only one that needs the routes.
//
// The atoms below — `addTowerAt`, `removeTowerById`, `clearAllTowers` — pose a
// floor and pay nothing. The acts — `placeHeld`, `upgradeAt`, `sellAt` — are the
// single things a player does, each with every consequence the specification
// gives it.

import {
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  MAX_LEVEL,
  ROWS,
  TILE,
  TOWER_DEFS,
  type TowerType,
} from "./constants";
import {
  coversTile,
  footprintTiles,
  sizeOf,
  tileAt,
  tileIndex,
} from "./geometry";
import { buildZoneOf, insideZone } from "./modes";
import { blockedOf, routesFromBlocked, routesOf } from "./routes";
import { costOf, flying, upgradeCostOf, refundOf } from "./stats";
import type { MeltdownState, TowerState } from "./game";

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * The footprint the pointer holds: the `size x size` block nearest `(x, y)`,
 * clamped so the whole footprint stays on the grid (specs/building.md).
 */
export function previewTileFor(
  x: number,
  y: number,
  size: number,
): { col: number; row: number } {
  return {
    col: clamp(Math.round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size),
    row: clamp(Math.round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size),
  };
}

/**
 * Whether a footprint of `type` anchored at `(col, row)` could be placed right
 * now: on the grid, every tile open, no tile under a unit, affordable, inside
 * any mode build zone, and not sealing the floor.
 */
export function footprintValid(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  const size = sizeOf(type);
  if (col < 0 || row < 0 || col + size > COLS || row + size > ROWS) {
    return false;
  }
  if (state.money < costOf(type)) return false;

  const zone = buildZoneOf(state.mode);
  const tiles = footprintTiles(type, col, row);
  if (zone) {
    for (const tile of tiles) {
      if (!insideZone(zone, tile.col, tile.row)) return false;
    }
  }

  const blocked = blockedOf(state.towers);
  for (const tile of tiles) {
    if (blocked[tileIndex(tile.col, tile.row)] === 1) return false;
  }

  for (const unit of state.surge) {
    const tile = tileAt(unit.x, unit.y);
    for (const covered of tiles) {
      if (covered.col === tile.col && covered.row === tile.row) return false;
    }
  }

  return !seals(
    state,
    tiles.map((tile) => tileIndex(tile.col, tile.row)),
  );
}

/**
 * The never-seal rule: with the candidate's tiles blocked as well, either vent
 * must still reach its opposite exhaust and every ground unit on the floor must
 * still reach its own (specs/mazing.md).
 */
function seals(state: MeltdownState, candidate: readonly number[]): boolean {
  const blocked = blockedOf(state.towers);
  for (const index of candidate) blocked[index] = 1;
  const routes = routesFromBlocked(blocked);
  if (!Number.isFinite(routes.leftLength)) return true;
  if (!Number.isFinite(routes.topLength)) return true;
  for (const unit of state.surge) {
    if (flying(unit.type)) continue;
    const tile = tileAt(unit.x, unit.y);
    const field = unit.vent === "left" ? routes.right : routes.bottom;
    const at = tileIndex(tile.col, tile.row);
    if (at < 0 || at >= field.length || !Number.isFinite(field[at]))
      return true;
  }
  return false;
}

/** Whether the held preview, if any, could be placed right now. */
export function heldValid(state: MeltdownState): boolean {
  if (!state.build) return false;
  return footprintValid(
    state,
    state.build.type,
    state.build.col,
    state.build.row,
  );
}

/** A fresh tower record, posed or placed. */
export function newTower(
  id: number,
  type: TowerType,
  col: number,
  row: number,
  rotation: number,
  fresh: boolean,
): TowerState {
  return {
    id,
    type,
    col,
    row,
    rotation: ((Math.trunc(rotation) % 4) + 4) % 4,
    level: 1,
    heat: 0,
    tripped: false,
    tripTimer: 0,
    fireClock: 0,
    targeting: null,
    firing: false,
    kills: 0,
    damageDealt: 0,
    spent: costOf(type),
    fresh,
    firingEnabled: true,
    thermalEnabled: true,
  };
}

/**
 * The atom: one tower on the floor at `(col, row)`, costing nothing and running
 * no placement check (specs/instrumentation.md, The towers).
 */
export function addTowerAt(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
  rotation: number,
): MeltdownState {
  const tower = newTower(state.nextId, type, col, row, rotation, true);
  return {
    ...state,
    towers: [...state.towers, tower],
    nextId: state.nextId + 1,
  };
}

/** The atom: that tower gone, its footprint reopened, no refund paid. */
export function removeTowerById(
  state: MeltdownState,
  id: number,
): MeltdownState {
  return { ...state, towers: state.towers.filter((tower) => tower.id !== id) };
}

/** The atom: every tower gone, the surge left standing. */
export function clearAllTowers(state: MeltdownState): MeltdownState {
  return { ...state, towers: [] };
}

/** Arm a type, or disarm. Arming returns the held rotation to `0`. */
export function armType(
  state: MeltdownState,
  type: TowerType | null,
): MeltdownState {
  if (type === null) return { ...state, build: null };
  const anchor = previewTileFor(state.pointer.x, state.pointer.y, sizeOf(type));
  return {
    ...state,
    build: { type, col: anchor.col, row: anchor.row, rotation: 0 },
  };
}

/** Move the held preview so its footprint's top-left sits at `(col, row)`. */
export function movePreview(
  state: MeltdownState,
  col: number,
  row: number,
): MeltdownState {
  if (!state.build) return state;
  // NO CLAMP HERE, deliberately. A pointer's move runs through
  // `previewToPoint`, which clamps because specs/building.md says the FOLLOWING
  // footprint stays on the grid; this is the surface's own pose, and
  // specs/instrumentation.md says a pose reaches the tile it names. A footprint
  // hanging off the grid is one `heldValid` answers `false` for.
  return { ...state, build: { ...state.build, col, row } };
}

/** Carry the held preview to the pointer at `(x, y)`. */
export function previewToPoint(
  state: MeltdownState,
  x: number,
  y: number,
): MeltdownState {
  if (!state.build) return state;
  const anchor = previewTileFor(x, y, sizeOf(state.build.type));
  return { ...state, build: { ...state.build, ...anchor } };
}

/** Set the held rotation outright. */
export function setHeldRotation(
  state: MeltdownState,
  rotation: number,
): MeltdownState {
  if (!state.build) return state;
  return {
    ...state,
    build: { ...state.build, rotation: ((Math.trunc(rotation) % 4) + 4) % 4 },
  };
}

/** Advance the held rotation one step, wrapping from `3` to `0`. */
export function rotateHeld(state: MeltdownState): MeltdownState {
  if (!state.build) return state;
  return setHeldRotation(state, state.build.rotation + 1);
}

/**
 * The act: commit the held preview if it is valid, exactly as a press on the
 * floor does. Placement stays armed afterwards and disarms only when the money
 * left cannot cover another copy.
 */
export function placeHeld(state: MeltdownState): {
  state: MeltdownState;
  placed: boolean;
} {
  const held = state.build;
  if (!held || !heldValid(state)) return { state, placed: false };
  const cost = costOf(held.type);
  const tower = newTower(
    state.nextId,
    held.type,
    held.col,
    held.row,
    held.rotation,
    state.phase !== "wave",
  );
  const money = state.money - cost;
  return {
    state: {
      ...state,
      money,
      towers: [...state.towers, tower],
      nextId: state.nextId + 1,
      build: money < cost ? null : held,
    },
    placed: true,
  };
}

/**
 * The act: one level, through the real upgrade code. An upgrade that is
 * unaffordable, or asked of a level III tower, changes nothing at all.
 */
export function upgradeAt(
  state: MeltdownState,
  id: number,
): { state: MeltdownState; upgraded: boolean } {
  const tower = state.towers.find((entry) => entry.id === id);
  if (!tower || tower.level >= MAX_LEVEL) return { state, upgraded: false };
  const cost = upgradeCostOf(tower);
  if (state.money < cost) return { state, upgraded: false };
  return {
    state: {
      ...state,
      money: state.money - cost,
      towers: state.towers.map((entry) =>
        entry.id === id
          ? { ...entry, level: entry.level + 1, spent: entry.spent + cost }
          : entry,
      ),
    },
    upgraded: true,
  };
}

/**
 * The act: the tower's refund into the money, the tower off the floor, its
 * footprint reopened, and the selection cleared when it was the selected one.
 */
export function sellAt(
  state: MeltdownState,
  id: number,
): { state: MeltdownState; sold: boolean } {
  const tower = state.towers.find((entry) => entry.id === id);
  if (!tower) return { state, sold: false };
  return {
    state: {
      ...state,
      money: state.money + refundOf(tower),
      towers: state.towers.filter((entry) => entry.id !== id),
      selected: state.selected === id ? null : state.selected,
    },
    sold: true,
  };
}

/** The tower whose footprint covers `(col, row)`, if any. */
export function towerAtTile(
  state: MeltdownState,
  col: number,
  row: number,
): TowerState | null {
  for (const tower of state.towers) {
    if (coversTile(tower, col, row)) return tower;
  }
  return null;
}

/** The routes the floor currently offers. */
export function routesOfState(
  state: MeltdownState,
): ReturnType<typeof routesOf> {
  return routesOf(state.towers);
}

/** Whether a type is one of the eight the shop lists. */
export function isTowerType(value: string): value is TowerType {
  return value in TOWER_DEFS;
}
