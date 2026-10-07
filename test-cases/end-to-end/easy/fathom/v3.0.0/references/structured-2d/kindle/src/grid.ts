// Fathom — the tile grid's vocabulary.
//
// The four cardinal directions, the four-character tile alphabet the snapshot
// reports, and the conversions between a tile and the logical units
// `specs/overview.md` fixes. Everything the maze, the movers and the fog are
// written in starts here, and every figure comes from `src/constants.ts`.

import {
  GRID_COLS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Y,
  GRID_ROWS,
  TILE,
} from "./constants";

/**
 * A cardinal direction. A body at rest still faces one of these, which is why
 * there is no value for "stopped": a body reports rest by carrying a `null`
 * heading beside the direction it faces.
 */
export type Dir = "up" | "down" | "left" | "right";

/** The four directions, in the order every scan of them runs. */
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];

/** One step in a direction, in tiles. */
export interface Offset {
  readonly dtx: number;
  readonly dty: number;
}

const OFFSETS: Readonly<Record<Dir, Offset>> = {
  up: { dtx: 0, dty: -1 },
  down: { dtx: 0, dty: 1 },
  left: { dtx: -1, dty: 0 },
  right: { dtx: 1, dty: 0 },
};

export function offsetOf(dir: Dir): Offset {
  return OFFSETS[dir];
}

const OPPOSITES: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export function opposite(dir: Dir): Dir {
  return OPPOSITES[dir];
}

/** Whether `to` turns off `from` rather than continuing or reversing it. */
export function isTurn(from: Dir, to: Dir): boolean {
  return to !== from && to !== opposite(from);
}

/** The four tile kinds, in exactly the alphabet `specs/state.md` reports. */
export type TileKind = "#" | "." | "g" | "d";

/** A tile of the grid, by column and row. */
export interface Cell {
  readonly tx: number;
  readonly ty: number;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.tx === b.tx && a.ty === b.ty;
}

/** The number of tiles between two cells, counted along the two axes. */
export function tileDistance(a: Cell, b: Cell): number {
  return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);
}

export function inGrid(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_COLS && ty >= 0 && ty < GRID_ROWS;
}

/** A tile's own index, which is what the fog and the plankton are keyed by. */
export function cellIndex(tx: number, ty: number): number {
  return ty * GRID_COLS + tx;
}

export function cellOfIndex(index: number): Cell {
  return { tx: index % GRID_COLS, ty: Math.floor(index / GRID_COLS) };
}

export function tileCenterX(tx: number): number {
  return GRID_ORIGIN_X + tx * TILE + TILE / 2;
}

export function tileCenterY(ty: number): number {
  return GRID_ORIGIN_Y + ty * TILE + TILE / 2;
}

export function columnAt(x: number): number {
  return Math.floor((x - GRID_ORIGIN_X) / TILE);
}

export function rowAt(y: number): number {
  return Math.floor((y - GRID_ORIGIN_Y) / TILE);
}

/** The tile whose bounds contain a point, which is the tile a body is on. */
export function cellAt(x: number, y: number): Cell {
  return { tx: columnAt(x), ty: rowAt(y) };
}

/** The left edge of the maze region, and how wide the whole grid runs. */
export const MAZE_LEFT = GRID_ORIGIN_X;
export const MAZE_WIDTH = GRID_COLS * TILE;
