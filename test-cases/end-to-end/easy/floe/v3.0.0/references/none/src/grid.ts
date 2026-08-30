// Floe — the strait's geometry, as questions the rest of the build asks.
//
// `specs/strait.md` fixes the map and the bands and `src/constants.ts` states the
// figures; this module is the derived reading of them. Nothing here holds state.

import {
  BAYS,
  COLS,
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  ROWS,
  WATER_BOTTOM,
  WATER_TOP,
} from "./constants";
import type { Facing } from "./types";

/** One of the five bands, plus the far shore's two rows told apart. */
export type Band = "cap" | "bays" | "water" | "median" | "ice" | "near";

/** The band a strait row belongs to. */
export function bandOf(row: number): Band {
  if (row <= ROW_CAP) return "cap";
  if (row === ROW_BAYS) return "bays";
  if (row >= WATER_TOP && row <= WATER_BOTTOM) return "water";
  if (row === ROW_MEDIAN) return "median";
  if (row >= ICE_TOP && row <= ICE_BOTTOM) return "ice";
  return "near";
}

/** Whether the row is one of the eight the water band occupies. */
export function isWaterRow(row: number): boolean {
  return row >= WATER_TOP && row <= WATER_BOTTOM;
}

/** Whether the row is one of the eight the ice band occupies. */
export function isIceRow(row: number): boolean {
  return row >= ICE_TOP && row <= ICE_BOTTOM;
}

/** Whether the row is solid ground whatever is on it: the shores and the median. */
export function isSolidRow(row: number): boolean {
  const band = bandOf(row);
  return band === "near" || band === "median" || band === "ice";
}

/** The bay a far-shore column belongs to, or `-1` where the shore is solid. */
export function bayIndexAtCol(col: number): number {
  for (let index = 0; index < BAYS.length; index += 1) {
    const [left, right] = BAYS[index];
    if (col === left || col === right) return index;
  }
  return -1;
}

/** The two columns a bay occupies. */
export function bayColumns(index: number): readonly [number, number] {
  return BAYS[index];
}

/** The stage `x` a bay's two columns are centered on. */
export function bayCenterX(index: number): number {
  const [left, right] = BAYS[index];
  return ((left + right + 1) / 2) * 32;
}

/** The column offset of a facing. */
export function facingDX(facing: Facing): number {
  return facing === "left" ? -1 : facing === "right" ? 1 : 0;
}

/** The row offset of a facing. */
export function facingDY(facing: Facing): number {
  return facing === "up" ? -1 : facing === "down" ? 1 : 0;
}

/** The four grid directions, in the fixed order every tie is broken by. */
export const DIRECTIONS: readonly Facing[] = ["up", "down", "left", "right"];

/** The tile distance between two tiles: the sum of the absolute differences. */
export function tileDistance(
  aCol: number,
  aRow: number,
  bCol: number,
  bRow: number,
): number {
  return Math.abs(aCol - bCol) + Math.abs(aRow - bRow);
}

/** A column clamped onto the strait. */
export function clampCol(col: number): number {
  return Math.max(0, Math.min(COLS - 1, col));
}

/** A row clamped onto the strait. */
export function clampRow(row: number): number {
  return Math.max(0, Math.min(ROWS - 1, row));
}

/** The rows a crossing has advanced, given the topmost row it has reached. */
export function rowsAdvanced(bestRow: number): number {
  return ROW_NEAR - bestRow;
}
