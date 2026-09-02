// Orrery — the editor's five regions (specs/editor.md "Layout").
//
// The heading, the tray, the field, the readout, and the tape panel divide the
// whole stage between them, and a press is answered by the region it lands in:
// the heading and the readout are display only and answer nothing, the tray
// begins a placement, the field selects and drags, and the tape panel points
// the cursor.
//
// EVERY rectangle this game fixes includes its lower bound and excludes its
// upper, so a point on a shared edge belongs to the region below and to the
// right of it. That single rule decides the two corners the specification calls
// out: `(TRAY_REGION_W, HEADING_H)` is the field's, and
// `(TRAY_REGION_W, TAPE_Y0)` is the tape panel's.

import {
  HEADING_H,
  READOUT_X0,
  STAGE_H,
  STAGE_W,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";

/** A rectangle on the stage, its lower bounds included and its upper excluded. */
export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The five regions the editor divides the stage into. */
export type EditorRegion = "heading" | "tray" | "field" | "readout" | "tape";

/** Whether a point lies inside a half-open rectangle. */
export function insideRect(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return x >= x0 && x < x1 && y >= y0 && y < y1;
}

/**
 * Which region a stage position lies in, and `null` off the stage. The tests
 * run in the order the regions tile the stage: the heading spans the full
 * width, the tray the full height below it, the tape panel the width right of
 * the tray below `TAPE_Y0`, and the field and the readout share what is left.
 */
export function regionAt(x: number, y: number): EditorRegion | null {
  if (!insideRect(x, y, 0, 0, STAGE_W, STAGE_H)) return null;
  if (y < HEADING_H) return "heading";
  if (x < TRAY_REGION_W) return "tray";
  if (y >= TAPE_Y0) return "tape";
  return x < READOUT_X0 ? "field" : "readout";
}

/**
 * Whether a stage position lies inside the tape panel's extent,
 * `x >= TRAY_REGION_W` and `y >= TAPE_Y0` (specs/controls.md "Focus"). This is
 * the focus rule's own test, which is stated over the panel's extent rather
 * than over the region tiling, so a press below the tray's foot still reads as
 * a field press.
 */
export function insideTapePanel(x: number, y: number): boolean {
  return x >= TRAY_REGION_W && y >= TAPE_Y0;
}
