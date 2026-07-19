// Floe — grid & band geometry helpers (specs/playfield.md).
//
// The strait is a 40x20 grid of 32px tiles. All strait objects use strait-local
// coordinates; the strait sits at stage y = STRAIT_TOP. A tile (c, r) has left =
// TILE*c and top = TILE*r (strait-local).

import {
  BAYS,
  COLS,
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
} from "./constants";

export type Band = "cap" | "bays" | "water" | "median" | "ice" | "near";

export function bandOf(row: number): Band {
  if (row <= 0) return "cap";
  if (row === ROW_BAYS) return "bays";
  if (row >= WATER_TOP && row <= WATER_BOTTOM) return "water";
  if (row === ROW_MEDIAN) return "median";
  if (row >= ICE_TOP && row <= ICE_BOTTOM) return "ice";
  return "near"; // row >= ROW_NEAR
}

export function isWaterRow(row: number): boolean {
  return row >= WATER_TOP && row <= WATER_BOTTOM;
}

export function isIceRow(row: number): boolean {
  return row >= ICE_TOP && row <= ICE_BOTTOM;
}

// A solid tile the critter/bear may stand on without a floe (from vehicles/water).
export function isSolidFooting(row: number): boolean {
  const b = bandOf(row);
  return b === "ice" || b === "median" || b === "near";
}

// Strait-local pixel center of a tile column's left edge for a 32px sprite.
export function colToX(col: number): number {
  return col * TILE;
}
export function rowToY(row: number): number {
  return row * TILE;
}

// Column a strait-local x (left edge of a 32px sprite) maps to.
export function xToCol(x: number): number {
  return Math.round(x / TILE);
}

// Is the given column the left/right tile of an OPEN bay? (bays indexed 0..4)
export function bayIndexAtCol(col: number): number {
  for (let i = 0; i < BAYS.length; i++) {
    const [c0, c1] = BAYS[i];
    if (col === c0 || col === c1) return i;
  }
  return -1;
}

export function clampCol(col: number): number {
  return Math.max(0, Math.min(COLS - 1, col));
}

// Row extremes the critter may occupy (row 1 only via a bay; never row 0).
export const MIN_CRITTER_ROW = ROW_BAYS;
export const MAX_CRITTER_ROW = ROW_NEAR;
