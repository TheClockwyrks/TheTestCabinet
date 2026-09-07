// Fathom — the tile grid: directions, and the conversion between logical units
// and tile coordinates.
//
// `specs/overview.md` fixes the grid as `GRID_COLS x GRID_ROWS` tiles of `TILE`
// units each, with column 0's left edge at `GRID_ORIGIN_X` and row 0's top edge
// at `GRID_ORIGIN_Y`. Every figure here comes from `src/constants.ts`; this module
// is the arithmetic over them and holds no state.

import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
} from "./constants";
import type { Dir, Tile } from "./state";

/** The four cardinal directions, in a fixed order so every scan walks them alike. */
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];

/** The step one move in `dir` takes, in tiles. */
export function dirStep(dir: Dir): {
  readonly dx: number;
  readonly dy: number;
} {
  switch (dir) {
    case "up":
      return { dx: 0, dy: -1 };
    case "down":
      return { dx: 0, dy: 1 };
    case "left":
      return { dx: -1, dy: 0 };
    case "right":
      return { dx: 1, dy: 0 };
  }
}

/** The direction facing the other way. */
export function opposite(dir: Dir): Dir {
  switch (dir) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/** Whether `a` and `b` are at right angles to one another. */
export function perpendicular(a: Dir, b: Dir): boolean {
  return a !== b && b !== opposite(a);
}

/** The x of the center of column `tx`. */
export function centerX(tx: number): number {
  return GRID_ORIGIN_X + tx * TILE + TILE / 2;
}

/** The y of the center of row `ty`. */
export function centerY(ty: number): number {
  return GRID_ORIGIN_Y + ty * TILE + TILE / 2;
}

/** The column whose bounds contain `x`. */
export function columnAt(x: number): number {
  return Math.floor((x - GRID_ORIGIN_X) / TILE);
}

/** The row whose bounds contain `y`. */
export function rowAt(y: number): number {
  return Math.floor((y - GRID_ORIGIN_Y) / TILE);
}

/** Whether `(tx, ty)` names a tile of the grid. */
export function onGrid(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS;
}

/** The index `(tx, ty)` takes in a flat, row-major array over the grid. */
export function tileIndex(tx: number, ty: number): number {
  return ty * GRID_COLS + tx;
}

/** The tile a flat, row-major index names. */
export function tileAtIndex(index: number): Tile {
  return { tx: index % GRID_COLS, ty: Math.floor(index / GRID_COLS) };
}

/** How many cells a flat, row-major array over the grid holds. */
export const GRID_CELLS = GRID_COLS * GRID_ROWS;

/** The straight-line distance between two points, in logical units. */
export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The shortest distance from `(px, py)` to the segment joining `(ax, ay)` and
 * `(bx, by)`. Ink reads it to decide whether a cloud lies on the line between a
 * hunter and the forager (`specs/sensing.md`).
 */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSquared),
  );
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}
