// Meltdown — what a player does to a tower (specs/building.md).
//
// Two kinds of thing live here, and the difference is deliberate.
//
//   * ATOMS — `addTower`, `removeTower`, `clearTowers` — pose the floor. They
//     cost nothing, spend nothing, and run no placement check. They are how a
//     driven scenario arranges a floor holding only what it is about.
//   * ACTS — `place`, `upgrade`, `sell` — are single things a player does, and
//     each has every consequence the rules give it: a cost deducted, tiles
//     blocked, routes recomputed, a refund paid, a selection cleared.
//
// A cue belongs to the frame that resolved the event, so every act takes a cue
// SINK rather than reaching audio itself: the frame loop hands it one that
// plays, and the debug surface hands it one that does nothing, because a debug
// act resolves outside any frame (specs/instrumentation.md).

import {
  COLS,
  CUES,
  FLOOR_X0,
  FLOOR_Y0,
  MAX_LEVEL,
  ROWS,
  TILE,
  inBounds,
} from "./constants";
import { TOWER_DEFS } from "./defs";
import { OPENING_TILES, footprintTiles, idx } from "./grid";
import { modeFigures } from "./modes";
import { rebuildFloor, type MeltdownState, type Tower } from "./state";
import { createTower, refundOf, towerById, upgradeCostOfTower } from "./towers";
import { exhaustOf, fliesOf, tileOf } from "./units";
import type { Rotation, TowerType } from "./types";

/** Where a cue goes. The frame loop plays it; a debug act discards it. */
export type CueSink = (cue: string) => void;

/** The sink an act called from outside a frame is handed. */
export const NO_CUES: CueSink = () => undefined;

/** `min(max(v, lo), hi)`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * The footprint's top-left tile for a `size`-tile preview held at `(x, y)`,
 * clamped so the whole footprint stays on the grid (specs/building.md).
 */
export function previewTile(
  x: number,
  y: number,
  size: number,
): { col: number; row: number } {
  return {
    col: clamp(Math.round((x - FLOOR_X0) / TILE - size / 2), 0, COLS - size),
    row: clamp(Math.round((y - FLOOR_Y0) / TILE - size / 2), 0, ROWS - size),
  };
}

/** Whether every tile of a footprint lies inside the mode's build zone. */
function insideBuildZone(
  state: MeltdownState,
  col: number,
  row: number,
  size: number,
): boolean {
  const zone = modeFigures(state.mode, state.difficulty).buildZone;
  if (zone === null) return true;
  return (
    col >= zone.col0 &&
    row >= zone.row0 &&
    col + size - 1 <= zone.col1 &&
    row + size - 1 <= zone.row1
  );
}

/**
 * Whether the floor would still be crossable with `extra` blocked as well: both
 * vents reach their opposite exhausts, and every ground unit reaches its own
 * (specs/mazing.md).
 */
export function wouldStaySolvable(
  state: MeltdownState,
  extra: ReadonlySet<number>,
): boolean {
  const toRight = state.floor.reachable(OPENING_TILES.right, extra);
  const toBottom = state.floor.reachable(OPENING_TILES.bottom, extra);
  const opens = (opening: "left" | "top", reach: Uint8Array): boolean =>
    OPENING_TILES[opening].some(
      (tile) =>
        state.floor.blocked[tile] === 0 &&
        !extra.has(tile) &&
        reach[tile] === 1,
    );
  if (!opens("left", toRight)) return false;
  if (!opens("top", toBottom)) return false;
  for (const unit of state.surge) {
    if (fliesOf(unit)) continue;
    const { c, r } = tileOf(unit);
    if (!inBounds(c, r)) continue;
    const reach = exhaustOf(unit) === "right" ? toRight : toBottom;
    if (reach[idx(c, r)] !== 1) return false;
  }
  return true;
}

/**
 * Whether a held footprint could be placed right now: the six conditions of
 * `specs/building.md`, in the order that file states them.
 */
export function previewValid(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  const size = TOWER_DEFS[type].size;
  if (col < 0 || row < 0 || col + size > COLS || row + size > ROWS)
    return false;

  const tiles = footprintTiles(col, row, size);
  const covered = new Set(tiles);
  for (const tile of tiles) {
    if (state.floor.blocked[tile] === 1) return false;
  }
  for (const unit of state.surge) {
    const { c, r } = tileOf(unit);
    if (inBounds(c, r) && covered.has(idx(c, r))) return false;
  }
  if (state.money < TOWER_DEFS[type].cost) return false;
  if (!insideBuildZone(state, col, row, size)) return false;
  return wouldStaySolvable(state, covered);
}

/** Whether the held preview, if there is one, could be placed right now. */
export function heldIsValid(state: MeltdownState): boolean {
  if (state.build === null) return false;
  return previewValid(
    state,
    state.build.type,
    state.build.col,
    state.build.row,
  );
}

/** Arm placement for a type, holding its preview under the pointer. */
export function arm(state: MeltdownState, type: TowerType | null): void {
  if (type === null) {
    state.build = null;
    return;
  }
  const size = TOWER_DEFS[type].size;
  const { col, row } = previewTile(state.pointer.x, state.pointer.y, size);
  state.build = { type, col, row, rotation: 0 };
}

/**
 * Move the held preview so its footprint's top-left sits at `(col, row)`, there
 * and nowhere else.
 *
 * NO CLAMP HERE, deliberately. A pointer's move runs through `movePreviewTo`,
 * which clamps because `specs/building.md` says the FOLLOWING footprint stays on
 * the grid; this is the surface's own pose, and `specs/instrumentation.md` says a
 * pose reaches the tile it names. A footprint hanging off the grid is one
 * `previewValid` answers `false` for, so the caller reads what it asked for.
 * The surface guards the empty-hand case before calling in.
 */
export function movePreview(
  state: MeltdownState,
  col: number,
  row: number,
): void {
  if (state.build === null) return;
  state.build.col = col;
  state.build.row = row;
}

/** Move the held preview so its footprint is the block nearest `(x, y)`. */
export function movePreviewTo(
  state: MeltdownState,
  x: number,
  y: number,
): void {
  if (state.build === null) return;
  const size = TOWER_DEFS[state.build.type].size;
  const { col, row } = previewTile(x, y, size);
  state.build.col = col;
  state.build.row = row;
}

/** Turn the held preview one 90-degree step. With nothing held, do nothing. */
export function rotatePreview(state: MeltdownState): void {
  if (state.build === null) return;
  state.build.rotation = ((state.build.rotation + 1) % 4) as Rotation;
}

/** Set the held rotation outright. */
export function setPreviewRotation(
  state: MeltdownState,
  rotation: Rotation,
): void {
  if (state.build === null) return;
  state.build.rotation = rotation;
}

/**
 * The atom: one tower on the floor at no cost, with no placement check, level I,
 * cold, fresh, both faculties on, appended to the roster.
 */
export function addTower(
  state: MeltdownState,
  type: TowerType,
  col: number,
  row: number,
  rotation: Rotation,
): Tower {
  const tower = createTower(state.nextId, type, col, row, rotation);
  state.nextId += 1;
  state.towers.push(tower);
  rebuildFloor(state);
  return tower;
}

/** The atom: that tower gone, its footprint reopened, the routes recomputed. */
export function removeTower(state: MeltdownState, id: number): void {
  const index = state.towers.findIndex((tower) => tower.id === id);
  if (index < 0) return;
  state.towers.splice(index, 1);
  if (state.selected === id) state.selected = null;
  rebuildFloor(state);
}

/** The atom: an empty floor, with no refund and no change to money or score. */
export function clearTowers(state: MeltdownState): void {
  state.towers = [];
  state.selected = null;
  rebuildFloor(state);
}

/**
 * The act: commit the held preview if it is valid.
 *
 * Placement stays armed at the same type and rotation afterward, so a second
 * copy drops without arming again, and disarms only when the money left is below
 * the type's cost.
 */
export function place(state: MeltdownState, cue: CueSink): Tower | null {
  const held = state.build;
  if (held === null || !heldIsValid(state)) return null;
  const def = TOWER_DEFS[held.type];
  state.money -= def.cost;
  const tower = addTower(state, held.type, held.col, held.row, held.rotation);
  tower.fresh = state.phase !== "wave";
  if (state.money < def.cost) state.build = null;
  cue(CUES.place);
  return tower;
}

/** The act: one level up, paid for, through the real upgrade code. */
export function upgrade(state: MeltdownState, id: number): boolean {
  const tower = towerById(state.towers, id);
  if (tower === null || tower.level >= MAX_LEVEL) return false;
  const cost = upgradeCostOfTower(tower);
  if (state.money < cost) return false;
  state.money -= cost;
  tower.spent += cost;
  tower.level = (tower.level + 1) as Tower["level"];
  return true;
}

/** The act: the refund paid, the tower gone, the footprint reopened. */
export function sell(state: MeltdownState, id: number, cue: CueSink): boolean {
  const tower = towerById(state.towers, id);
  if (tower === null) return false;
  state.money += refundOf(tower);
  removeTower(state, id);
  cue(CUES.sell);
  return true;
}
