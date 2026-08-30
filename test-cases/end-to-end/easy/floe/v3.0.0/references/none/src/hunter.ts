// Floe — the bear's own arithmetic: which tiles are open to it, where it steps
// next, and how it travels.
//
// `specs/hunter.md` states the routing rule as a PROPERTY of the step rather than
// as an algorithm — the first step of a shortest route over open tiles, then two
// named fallbacks — so the search below is this build's choice and nothing about
// it is a figure. The strait is 40 by 20, so a breadth-first pass over 800 tiles
// per committed step costs a few microseconds and needs nothing but the roster.
//
// TWO GRIDS, NOT ONE. A tile is CLOSED when it is off the grid, on the far shore,
// or covered by a vehicle now; a step into one is refused. A tile is OPEN when it
// is not closed AND no vehicle of its lane reaches it within `BEAR_AVOID_LEAD`;
// routing only ever chooses an open tile. The two readings are different
// questions and the specification keeps them apart, so this file does too.

import {
  BEAR_AVOID_LEAD,
  COLS,
  ROWS,
  ROW_BAYS,
  ROW_CAP,
  TILE,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import { DIRECTIONS, facingDX, facingDY, tileDistance } from "./grid";
import { coversTile, laneAt } from "./lanes";
import { bearSpeed, facingBetween, isSettled } from "./entities";
import type { Bear, Facing, FloeState } from "./types";

/** A tile grid of flags, indexed by `row * COLS + col`. */
type Grid = Uint8Array;

/** The index of a tile in a {@link Grid}. */
function at(col: number, row: number): number {
  return row * COLS + col;
}

/**
 * Whether a tile is closed to a bear: off the grid, on the far shore, or covered
 * by a vehicle (specs/hunter.md).
 */
export function tileClosed(
  state: FloeState,
  col: number,
  row: number,
): boolean {
  if (!inBounds(col, row)) return true;
  if (row === ROW_CAP || row === ROW_BAYS) return true;
  for (const item of state.vehicles) {
    if (item.row === row && coversTile(item, col)) return true;
  }
  return false;
}

/**
 * Which tiles a bear may route through: not closed, and not about to be swept.
 *
 * Built in one pass over the two rosters rather than by asking each of the 800
 * tiles about each vehicle, because the search below reads the whole grid.
 */
function openGrid(state: FloeState): Grid {
  const grid = new Uint8Array(COLS * ROWS).fill(1);
  for (let col = 0; col < COLS; col += 1) {
    grid[at(col, ROW_CAP)] = 0;
    grid[at(col, ROW_BAYS)] = 0;
  }
  for (const item of state.vehicles) {
    const lane = laneAt(state, item.row);
    const travel =
      lane === null ? 0 : lane.dir * lane.speed * TILE * BEAR_AVOID_LEAD;
    const from = Math.min(item.x, item.x + travel);
    const to = Math.max(item.x, item.x + travel) + TILE * item.len;
    if (item.row < 0 || item.row >= ROWS) continue;
    for (let col = 0; col < COLS; col += 1) {
      const center = tileCX(col);
      if (center >= from && center < to) grid[at(col, item.row)] = 0;
    }
  }
  return grid;
}

/** The tile distance from every open tile to the target, or `-1` where unreachable. */
function routeDistances(
  open: Grid,
  targetCol: number,
  targetRow: number,
): Int16Array {
  const distance = new Int16Array(COLS * ROWS).fill(-1);
  if (!inBounds(targetCol, targetRow) || open[at(targetCol, targetRow)] === 0) {
    return distance;
  }
  distance[at(targetCol, targetRow)] = 0;
  const queue = [at(targetCol, targetRow)];
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const col = index % COLS;
    const row = (index - col) / COLS;
    for (const facing of DIRECTIONS) {
      const nextCol = col + facingDX(facing);
      const nextRow = row + facingDY(facing);
      if (!inBounds(nextCol, nextRow)) continue;
      const next = at(nextCol, nextRow);
      if (open[next] === 0 || distance[next] !== -1) continue;
      distance[next] = distance[index] + 1;
      queue.push(next);
    }
  }
  return distance;
}

/**
 * The step a bear settled on its tile commits to, or `null` where it stands still.
 *
 * The three branches of `specs/hunter.md`, in the order it states them: the first
 * step of a shortest open route; failing that the open neighbor least far from
 * the target in tile distance; failing that no step at all. Ties are broken by
 * the fixed direction order in `src/grid.ts`, so the choice is reproducible.
 */
export function chooseStep(state: FloeState, bear: Bear): Facing | null {
  const open = openGrid(state);
  const distance = routeDistances(open, bear.target.col, bear.target.row);

  let routed: Facing | null = null;
  let routedCost = Infinity;
  let closest: Facing | null = null;
  let closestCost = Infinity;

  for (const facing of DIRECTIONS) {
    const col = bear.col + facingDX(facing);
    const row = bear.row + facingDY(facing);
    if (!inBounds(col, row) || open[at(col, row)] === 0) continue;

    const route = distance[at(col, row)];
    if (route !== -1 && route < routedCost) {
      routedCost = route;
      routed = facing;
    }
    const near = tileDistance(col, row, bear.target.col, bear.target.row);
    if (near < closestCost) {
      closestCost = near;
      closest = facing;
    }
  }

  return routed ?? closest;
}

/**
 * Commit a bear to travelling one tile, unless that tile is closed to it.
 *
 * The one path a step is taken by, whether the routing chose it or
 * `setBearStep` asked for it, so a posed step meets exactly the refusal a routed
 * one does (specs/instrumentation.md). Returns whether the step was taken.
 */
export function commitStep(
  state: FloeState,
  bear: Bear,
  facing: Facing,
): boolean {
  const col = bear.col + facingDX(facing);
  const row = bear.row + facingDY(facing);
  bear.facing = facing;
  if (tileClosed(state, col, row)) return false;
  bear.stepCol = col;
  bear.stepRow = row;
  return true;
}

/**
 * Carry a bear along the step it is on for one tick.
 *
 * When the tick's travel would take it past the center of the tile it is entering
 * it settles EXACTLY on that center for this tick and the leftover is carried
 * into the next one, so a bear turns only on a tile center and no distance is
 * lost there (specs/hunter.md).
 */
export function travelBear(state: FloeState, bear: Bear, dt: number): void {
  bear.prevX = bear.x;
  bear.prevY = bear.y;
  if (!bear.travel || isSettled(bear)) return;

  const distance = bearSpeed(state, bear) * dt + bear.carry;
  bear.carry = 0;
  const targetX = tileCX(bear.stepCol);
  const targetY = tileCY(bear.stepRow);
  const remaining = Math.abs(targetX - bear.x) + Math.abs(targetY - bear.y);

  if (distance >= remaining) {
    bear.x = targetX;
    bear.y = targetY;
    bear.col = bear.stepCol;
    bear.row = bear.stepRow;
    bear.carry = distance - remaining;
    return;
  }

  const dx = Math.sign(targetX - bear.x);
  const dy = Math.sign(targetY - bear.y);
  bear.x += dx * distance;
  bear.y += dy * distance;
}

/** Settle a bear onto a tile, so it is no longer between two (specs/instrumentation.md). */
export function settleBear(bear: Bear, col: number, row: number): void {
  bear.col = col;
  bear.row = row;
  bear.stepCol = col;
  bear.stepRow = row;
  bear.x = tileCX(col);
  bear.y = tileCY(row);
  bear.prevX = bear.x;
  bear.prevY = bear.y;
  bear.carry = 0;
}

/** The facing a bear travelling between two tiles is heading in. */
export function stepFacing(bear: Bear): Facing {
  if (isSettled(bear)) return bear.facing;
  return facingBetween(bear.col, bear.row, bear.stepCol, bear.stepRow);
}
