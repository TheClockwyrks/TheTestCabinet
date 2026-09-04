// Orrery — the tape panel's geometry (specs/editor.md "The tape panel").
//
// One row per arm and wheel, in placement order, with fixed row heights and
// cell widths. The two scroll positions are DERIVED from the cursor rather
// than stored, which is what makes the panel's state impossible to get out of
// step with the cursor: `firstRow` keeps the cursor's row the bottom visible
// one once the cursor passes the fifth, `firstCol` keeps the cursor's column
// the rightmost visible one once it passes the fortieth, and both rest at `0`
// with no cursor.
//
// The rectangles are the press targets. A press inside a cell points the
// cursor at that row and column, a press inside a label points it at that row
// and column `0`, and a press that lands on no row or cell leaves the cursor
// as it is — it never clears it and never rounds to a nearby row.

import {
  STAGE_H,
  STAGE_W,
  TAPE_CELL_W,
  TAPE_COLS_VISIBLE,
  TAPE_LABEL_W,
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_X0,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { tapeRowIndex, tapeRows } from "./machine";
import { type Rect } from "./regions";
import type { PartState } from "./types";

/** The stage `x` the cell columns begin at. */
export const TAPE_COL_X0 = TRAY_REGION_W + TAPE_X0;
/** The stage `x` a row's label ends at. */
export const TAPE_LABEL_X1 = TRAY_REGION_W + TAPE_LABEL_W;

/** Where the cursor points, as the panel reads it. */
export interface TapeCursor {
  readonly part: number;
  readonly col: number;
}

/** A row and a column the panel's geometry resolved a press to. */
export interface TapeHit {
  /** The part the row belongs to, by `id`. */
  readonly part: number;
  /** The column the press points the cursor at. */
  readonly col: number;
}

/**
 * The first row shown: `max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
 * `selectedRow` is the cursor's arm's index in placement order and `0` with no
 * cursor.
 */
export function tapeFirstRow(
  parts: readonly PartState[],
  cursor: TapeCursor | null,
): number {
  const selectedRow = cursor === null ? 0 : tapeRowIndex(parts, cursor.part);
  return Math.max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1));
}

/**
 * The first column shown: `max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and
 * `0` with no cursor.
 */
export function tapeFirstCol(cursor: TapeCursor | null): number {
  if (cursor === null) return 0;
  return Math.max(0, cursor.col - (TAPE_COLS_VISIBLE - 1));
}

/** Visible row `v`'s full-width band, `v` from `0` to `TAPE_ROWS_VISIBLE - 1`. */
export function tapeRowRect(v: number): Rect {
  return {
    x0: TRAY_REGION_W,
    y0: TAPE_Y0 + v * TAPE_ROW_H,
    x1: STAGE_W,
    y1: TAPE_Y0 + (v + 1) * TAPE_ROW_H,
  };
}

/** Visible row `v`'s label, at the left edge of its row. */
export function tapeLabelRect(v: number): Rect {
  const row = tapeRowRect(v);
  return { x0: row.x0, y0: row.y0, x1: TAPE_LABEL_X1, y1: row.y1 };
}

/** The rectangle of visible row `v`, visible column `u`. */
export function tapeCellRect(v: number, u: number): Rect {
  const row = tapeRowRect(v);
  return {
    x0: TAPE_COL_X0 + u * TAPE_CELL_W,
    y0: row.y0,
    x1: TAPE_COL_X0 + (u + 1) * TAPE_CELL_W,
    y1: row.y1,
  };
}

/** Which visible row a stage `y` lands in, and `null` below the last one. */
export function visibleRowAt(y: number): number | null {
  if (y < TAPE_Y0 || y >= STAGE_H) return null;
  const v = Math.floor((y - TAPE_Y0) / TAPE_ROW_H);
  return v >= 0 && v < TAPE_ROWS_VISIBLE ? v : null;
}

/** Which visible column a stage `x` lands in, and `null` outside them all. */
export function visibleColAt(x: number): number | null {
  if (x < TAPE_COL_X0) return null;
  const u = Math.floor((x - TAPE_COL_X0) / TAPE_CELL_W);
  return u >= 0 && u < TAPE_COLS_VISIBLE ? u : null;
}

/**
 * The row and column a press in the panel points the cursor at, and `null`
 * when it lands on no row or cell. A press inside a row's label points at
 * column `0`; a press between the label and the first column, or past the last
 * visible column, points at nothing.
 */
export function tapeHitAt(
  parts: readonly PartState[],
  cursor: TapeCursor | null,
  x: number,
  y: number,
): TapeHit | null {
  const v = visibleRowAt(y);
  if (v === null) return null;
  const rows = tapeRows(parts);
  const row = rows[tapeFirstRow(parts, cursor) + v];
  if (row === undefined) return null;
  if (x >= TRAY_REGION_W && x < TAPE_LABEL_X1) return { part: row.id, col: 0 };
  const u = visibleColAt(x);
  if (u === null) return null;
  return { part: row.id, col: tapeFirstCol(cursor) + u };
}
