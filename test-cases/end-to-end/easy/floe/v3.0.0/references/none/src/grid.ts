// Floe — the strait's geometry, as questions the rest of the build asks.
//
// `specs/strait.md` fixes the map and the bands and `src/constants.ts` states the
// figures; this module is the derived reading of them. Nothing here holds state.

import { BAYS, ROW_NEAR, TILE, WATER_BOTTOM, WATER_TOP } from "./constants";
import type { Facing } from "./types";

/** Whether the row is one of the eight the water band occupies. */
export function isWaterRow(row: number): boolean {
  return row >= WATER_TOP && row <= WATER_BOTTOM;
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
  return ((left + right + 1) / 2) * TILE;
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

/** The rows a crossing has advanced, given the topmost row it has reached. */
export function rowsAdvanced(bestRow: number): number {
  return ROW_NEAR - bestRow;
}
