// Floe — the strait's geometry, and the one covering rule the whole game reads.
//
// `specs/strait.md` owns the tile-to-stage map and the five bands; the map itself
// is seeded in `src/constants.ts` as `tileLeft`, `tileTop`, `tileCX`, `tileCY`,
// `colAt`, `rowAt` and `inBounds`, so nothing here derives it a second time. What
// this module adds is the QUERIES over that geometry: which band a row belongs to,
// which bay a column belongs to, and the covering rule `specs/ice.md` states once
// and `specs/water.md` reads by name.
//
// THE COVERING RULE HAS ONE FORM AND THREE READINGS. A lane item spans
// `[x, x + TILE * len)` on its own row. It covers a POINT in that range, it covers
// a TILE of its row when that tile's centre is covered, and it covers a BODY on
// that row when the body's centre is covered. There is no inset anywhere: an
// unstated inset is a threshold with no source, and every reading below is the
// bare interval.

import {
  BAYS,
  BAY_COUNT,
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  tileCX,
} from "./constants";

/** One of the five bands `specs/strait.md` divides the strait into. */
export type Band = "far-shore" | "water" | "median" | "ice" | "near-shore";

/** Which band a row belongs to. A row outside the grid belongs to none. */
export function bandOf(row: number): Band | null {
  if (row === ROW_CAP || row === ROW_BAYS) return "far-shore";
  if (row >= WATER_TOP && row <= WATER_BOTTOM) return "water";
  if (row === ROW_MEDIAN) return "median";
  if (row >= ICE_TOP && row <= ICE_BOTTOM) return "ice";
  if (row === ROW_NEAR) return "near-shore";
  return null;
}

/** Whether a row is one of the eight ice rows. */
export function isIceRow(row: number): boolean {
  return row >= ICE_TOP && row <= ICE_BOTTOM;
}

/** Whether a row is one of the eight water rows. */
export function isWaterRow(row: number): boolean {
  return row >= WATER_TOP && row <= WATER_BOTTOM;
}

/**
 * The bay covering a column of the bay row, or `null` where the shore is solid.
 *
 * `BAYS` fixes the five pairs exactly, so there is no latitude here to interpret:
 * a column is inside a bay or it is far shore.
 */
export function bayAt(col: number): number | null {
  for (let index = 0; index < BAY_COUNT; index += 1) {
    const pair = BAYS[index];
    if (col === pair[0] || col === pair[1]) return index;
  }
  return null;
}

/** The stage `x` of a bay's centre: the midpoint of its two columns. */
export function bayCenterX(index: number): number {
  const pair = BAYS[index];
  return (tileCX(pair[0]) + tileCX(pair[1])) / 2;
}

/** A lane item, as every covering reading needs it: a span on one row. */
export interface Span {
  readonly row: number;
  readonly x: number;
  readonly len: number;
}

/** Whether `item` covers the point `x` on its own row (`specs/ice.md`). */
export function coversPoint(item: Span, x: number): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** Whether `item` covers tile `(col, row)`: its row, and the tile's centre. */
export function coversTile(item: Span, col: number, row: number): boolean {
  return item.row === row && coversPoint(item, tileCX(col));
}

/** Whether any of `items` covers tile `(col, row)`. */
export function anyCoversTile(
  items: readonly Span[],
  col: number,
  row: number,
): boolean {
  return items.some((item) => coversTile(item, col, row));
}

/** Whether any of `items` on `row` covers the body centred at `x`. */
export function anyCoversBody(
  items: readonly Span[],
  row: number,
  x: number,
): boolean {
  return items.some((item) => item.row === row && coversPoint(item, x));
}

/** The tile distance between two tiles: the sum of the two absolute differences. */
export function tileDistance(
  ac: number,
  ar: number,
  bc: number,
  br: number,
): number {
  return Math.abs(ac - bc) + Math.abs(ar - br);
}

/** The four grid directions, as the unit steps a hop and a bear's glide take. */
export const STEPS = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
} as const;

/** The direction names, in the order every tie is broken in. */
export const DIRECTIONS = ["up", "down", "left", "right"] as const;

/** One of the four grid directions. */
export type Direction = (typeof DIRECTIONS)[number];
