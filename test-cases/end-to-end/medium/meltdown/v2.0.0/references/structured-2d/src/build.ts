// Meltdown — what a player does to a tower, and the atoms a floor is posed from.
//
// Two kinds of thing live here, and the difference is deliberate
// (specs/instrumentation.md). An ATOM poses one field with no side effect —
// `addTowerAt`, `removeTowerById`, `clearAllTowers` — and is what a scenario
// builds a floor out of. An ACT is a single indivisible thing a player does —
// `placeHeld`, `upgradeTowerById`, `sellTowerById` — and each has every
// consequence `specs/building.md` gives it, because the game does.
//
// Every one of them that changes the blocked set recomputes the routes on the
// spot, which is the whole of live re-pathing: nothing else in the game touches
// `state.routes`, so a route can never be stale.

import {
  COLS,
  MAX_LEVEL,
  ROWS,
  TILE,
  TOWER_DEFS,
  FLOOR_X0,
  FLOOR_Y0,
  inBounds,
  type TowerType,
} from "./constants";
import {
  blockedMask,
  footprintTiles,
  sizeOf,
  tileAt,
  tileIndex,
} from "./geometry";
import { computeRoutes, remainingFrom, routesFor } from "./routes";
import { refundOf, upgradeCostOf } from "./stats";
import { exhaustOf, unitTile } from "./surge";
import { figuresOf } from "./waves";
import { SURGE_DEFS } from "./constants";
import type { MeltdownState, TowerState } from "./game";

/** Rebuild the routes from the towers now standing. */
export function refreshRoutes(state: MeltdownState): void {
  state.routes = computeRoutes(state.towers);
}

/** Clamp a value into an inclusive range. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** The tower whose footprint covers a tile, or `null` for open floor. */
export function towerAtTile(
  state: MeltdownState,
  col: number,
  row: number,
): TowerState | null {
  for (const tower of state.towers) {
    const size = sizeOf(tower.type);
    if (
      col >= tower.col &&
      col < tower.col + size &&
      row >= tower.row &&
      row < tower.row + size
    ) {
      return tower;
    }
  }
  return null;
}

/** The tower at a stage position, or `null`. */
export function towerAtPoint(
  state: MeltdownState,
  x: number,
  y: number,
): TowerState | null {
  const tile = tileAt(x, y);
  if (!inBounds(tile.col, tile.row)) return null;
  return towerAtTile(state, tile.col, tile.row);
}

/**
 * The footprint top-left the held preview takes with the pointer at `(x, y)`:
 * the block nearest the pointer, clamped so the whole footprint stays on the
 * grid at every size (specs/building.md).
 */
export function previewTileFor(
  type: TowerType,
  x: number,
  y: number,
): { col: number; row: number } {
  const size = sizeOf(type);
  return {
    col: clamp(Math.round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size),
    row: clamp(Math.round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size),
  };
}

/** Whether a surge unit's centre occupies this tile. */
function unitOnTile(state: MeltdownState, col: number, row: number): boolean {
  return state.surge.some((unit) => {
    const tile = unitTile(unit);
    return tile.col === col && tile.row === row;
  });
}

/**
 * Whether blocking these tiles as well would seal the floor: either vent left
 * with no route to its opposite exhaust, or a ground unit left with no route
 * from the tile its centre occupies (specs/mazing.md).
 */
export function wouldSeal(
  state: MeltdownState,
  tiles: readonly { col: number; row: number }[],
): boolean {
  const blocked = blockedMask(state.towers);
  for (const tile of tiles) {
    if (inBounds(tile.col, tile.row))
      blocked[tileIndex(tile.col, tile.row)] = 1;
  }
  const candidate = routesFor(blocked);
  if (
    !Number.isFinite(candidate.lengths.left) ||
    !Number.isFinite(candidate.lengths.top)
  ) {
    return true;
  }
  for (const unit of state.surge) {
    if (SURGE_DEFS[unit.type].flies) continue;
    const tile = unitTile(unit);
    const left = remainingFrom(candidate, exhaustOf(unit), tile.col, tile.row);
    if (!Number.isFinite(left)) return true;
  }
  return false;
}

/**
 * The placement check, in full: all six conditions of `specs/building.md`, in
 * the order they are stated there.
 */
export function footprintValid(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  const size = sizeOf(type);
  const tiles = footprintTiles(col, row, size);

  for (const tile of tiles) {
    if (!inBounds(tile.col, tile.row)) return false;
    if (state.routes.blocked[tileIndex(tile.col, tile.row)] === 1) return false;
    if (unitOnTile(state, tile.col, tile.row)) return false;
  }

  if (state.money < TOWER_DEFS[type].cost) return false;

  const zone = figuresOf(state).buildZone;
  if (zone !== null) {
    for (const tile of tiles) {
      if (
        tile.col < zone.col0 ||
        tile.col > zone.col1 ||
        tile.row < zone.row0 ||
        tile.row > zone.row1
      ) {
        return false;
      }
    }
  }

  return !wouldSeal(state, tiles);
}

/** Whether the held preview could be placed right now. */
export function previewValid(state: MeltdownState): boolean {
  const build = state.build;
  if (build === null) return false;
  return footprintValid(state, build.type, build.col, build.row);
}

/**
 * The atom: one tower on the floor, costing nothing, spending nothing, and
 * running no placement check. It is appended to the roster, so its id is read
 * from the last entry.
 */
export function addTowerAt(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
  rotation: number,
  fresh = true,
): TowerState {
  const tower: TowerState = {
    id: state.nextId,
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
    spent: TOWER_DEFS[type].cost,
    fresh,
    firingEnabled: true,
    thermalEnabled: true,
  };
  state.nextId += 1;
  state.towers.push(tower);
  refreshRoutes(state);
  return tower;
}

/** The atom: that tower gone, its footprint reopened, and the routes rebuilt. */
export function removeTowerById(state: MeltdownState, id: number): boolean {
  const index = state.towers.findIndex((tower) => tower.id === id);
  if (index < 0) return false;
  state.towers.splice(index, 1);
  if (state.selected === id) state.selected = null;
  refreshRoutes(state);
  return true;
}

/** The atom: every tower gone, the surge left exactly where it stands. */
export function clearAllTowers(state: MeltdownState): void {
  state.towers = [];
  state.selected = null;
  refreshRoutes(state);
}

/** Arm a type, or disarm. The held rotation returns to `0` either way. */
export function armType(state: MeltdownState, type: TowerType | null): void {
  if (type === null) {
    state.build = null;
    return;
  }
  const at = previewTileFor(type, state.pointer.x, state.pointer.y);
  state.build = { type, col: at.col, row: at.row, rotation: 0 };
}

/**
 * Move the held preview to the anchor named, there and nowhere else.
 *
 * NO CLAMP HERE, deliberately. The pointer's own path reaches this through
 * `previewTileFor`, which clamps because specs/building.md says the FOLLOWING
 * footprint stays on the grid; the surface's `setPreview` reaches it directly,
 * and specs/instrumentation.md says a pose reaches the tile it names. A
 * footprint hanging off the grid is one `previewValid` answers `false` for.
 */
export function movePreview(
  state: MeltdownState,
  col: number,
  row: number,
): void {
  const build = state.build;
  if (build === null) return;
  build.col = Math.trunc(col);
  build.row = Math.trunc(row);
}

/** Turn the held preview one 90-degree step. Nothing held, nothing happens. */
export function rotatePreview(state: MeltdownState): void {
  if (state.build === null) return;
  state.build.rotation = (state.build.rotation + 1) % 4;
}

/** Set the held rotation outright. */
export function setPreviewRotation(
  state: MeltdownState,
  rotation: number,
): void {
  if (state.build === null) return;
  state.build.rotation = ((Math.trunc(rotation) % 4) + 4) % 4;
}

/**
 * The act: commit the held preview when it is valid. The money falls by exactly
 * the build cost, the tower lands at the held rotation, its tiles block, the
 * routes are recomputed, and placement stays armed unless the next copy is now
 * unaffordable.
 */
export function placeHeld(state: MeltdownState): boolean {
  const build = state.build;
  if (build === null) return false;
  if (!footprintValid(state, build.type, build.col, build.row)) return false;

  const cost = TOWER_DEFS[build.type].cost;
  state.money -= cost;
  // A tower placed while a wave is already running has already missed the
  // build phase it would have been fresh through (specs/building.md).
  addTowerAt(
    state,
    build.type,
    build.col,
    build.row,
    build.rotation,
    state.phase !== "wave",
  );
  if (state.money < cost) state.build = null;
  return true;
}

/**
 * The act: one level, paid for, on a tower below `MAX_LEVEL`. An upgrade that
 * is unaffordable, or one asked of a level III tower, changes nothing at all.
 */
export function upgradeTowerById(state: MeltdownState, id: number): boolean {
  const tower = state.towers.find((entry) => entry.id === id);
  if (tower === undefined) return false;
  if (tower.level >= MAX_LEVEL) return false;
  const cost = upgradeCostOf(tower);
  if (state.money < cost) return false;
  state.money -= cost;
  tower.spent += cost;
  tower.level += 1;
  return true;
}

/**
 * The act: the refund paid into the money, the tower gone, its footprint
 * reopened, the routes recomputed, and the selection cleared when the tower
 * sold was the selected one.
 */
export function sellTowerById(state: MeltdownState, id: number): boolean {
  const tower = state.towers.find((entry) => entry.id === id);
  if (tower === undefined) return false;
  state.money += refundOf(tower);
  removeTowerById(state, id);
  return true;
}
