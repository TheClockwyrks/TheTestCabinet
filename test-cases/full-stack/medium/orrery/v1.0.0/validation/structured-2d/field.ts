// Orrery — the hex field and the editor's rectangles, as the specification fixes
// them. CASE-PROVIDED, and the SAME FILE in all three engine projects.
//
// THIS IS AN ORACLE, NOT A READING. Nothing here asks the build anything. Every
// formula is quoted from `specs/field.md` (the axial coordinates, the stage
// position of a hex, the six directions, the rotation formulas, the field's
// extent, and the pointer's targeting rule) or from `specs/editor.md` (the five
// regions, the tray's slots, and the tape panel's rows and columns). A check
// computes where a thing ought to be from here and compares that against what the
// build put there.
//
// EVERY RECTANGLE IS HALF-OPEN. `specs/editor.md`: "Every extent above, and every
// rectangle this file fixes, includes its lower bound and excludes its upper, so
// a point on a shared edge belongs to the region below and to the right of it."
// `contains` is what says so, and it is the one place the rule is written.

import {
  FIELD_CX,
  FIELD_CY,
  FIELD_R,
  HEADING_H,
  HEX_HIT_R,
  HEX_PITCH,
  READOUT_X0,
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
  TRAY_SLOT_H,
  TRAY_W,
  TRAY_X0,
  TRAY_Y0,
  DIRS,
} from "./constants";

/* -------------------------------------------------------------------------- */
/* Hexes                                                                      */
/* -------------------------------------------------------------------------- */

/** One axial hex coordinate, as `specs/field.md` counts them. */
export interface Hex {
  q: number;
  r: number;
}

/** A position on the stage, in the logical units of `specs/overview.md`. */
export interface StagePoint {
  x: number;
  y: number;
}

/** An axis-aligned rectangle on the stage, half-open on its far edges. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A hex, spelled out. Convenience so a fixture reads `at(1, -2)`. */
export function at(q: number, r: number): Hex {
  return { q, r };
}

/** Whether two hexes are the same hex. */
export function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** `hexX(q, r) = FIELD_CX + HEX_PITCH * (q + r / 2)` (`specs/field.md`). */
export function hexX(q: number, r: number): number {
  return FIELD_CX + HEX_PITCH * (q + r / 2);
}

/**
 * `hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r` (`specs/field.md`).
 *
 * The `q` the formula names does not appear on its right-hand side — a
 * pointy-top row's height depends on `r` alone — and it is kept in the signature
 * so the pair reads as the specification writes it, `hexX(q, r)` and
 * `hexY(q, r)`, rather than as two functions of different shapes.
 */
export function hexY(_q: number, r: number): number {
  return FIELD_CY + HEX_PITCH * (Math.sqrt(3) / 2) * r;
}

/** The stage position of a hex's center. */
export function hexCenter(hex: Hex): StagePoint {
  return { x: hexX(hex.q, hex.r), y: hexY(hex.q, hex.r) };
}

/** The straight-line distance between two stage positions. */
export function distance(a: StagePoint, b: StagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Whether a hex lies on the field: the hexagonal region of radius `FIELD_R`
 * around `(0, 0)`, `max(|q|, |r|, |q + r|) <= FIELD_R` (`specs/field.md`).
 */
export function onField(hex: Hex): boolean {
  return (
    Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r)) <=
    FIELD_R
  );
}

/**
 * Every hex of the field, in reading order: ascending `r`, then ascending `q` —
 * the order `specs/simulation.md` resolves sigils in.
 *
 * Ninety-one hexes, as `specs/field.md` counts them.
 */
export function fieldHexes(): Hex[] {
  const hexes: Hex[] = [];
  for (let r = -FIELD_R; r <= FIELD_R; r += 1) {
    for (let q = -FIELD_R; q <= FIELD_R; q += 1) {
      if (onField({ q, r })) hexes.push({ q, r });
    }
  }
  return hexes;
}

/** Reading order — ascending `r`, then ascending `q` (`specs/simulation.md`). */
export function readingOrder(a: Hex, b: Hex): number {
  return a.r - b.r || a.q - b.q;
}

/** The hex one step from `hex` in direction `d`, `0` to `5` (`specs/field.md`). */
export function neighbor(hex: Hex, d: number): Hex {
  const step = DIRS[((d % 6) + 6) % 6] as readonly [number, number];
  return { q: hex.q + step[0], r: hex.r + step[1] };
}

/** All six neighbours of `hex`, in direction order. */
export function neighbors(hex: Hex): Hex[] {
  return [0, 1, 2, 3, 4, 5].map((d) => neighbor(hex, d));
}

/** Whether two hexes are adjacent: their difference is one of `DIRS`. */
export function adjacent(a: Hex, b: Hex): boolean {
  return DIRS.some(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

/** An offset rotated one 60 degree step clockwise: `(q, r) -> (-r, q + r)`. */
export function rotateCw(hex: Hex): Hex {
  return { q: -hex.r, r: hex.q + hex.r };
}

/** An offset rotated one step counterclockwise: `(q, r) -> (q + r, -q)`. */
export function rotateCcw(hex: Hex): Hex {
  return { q: hex.q + hex.r, r: -hex.q };
}

/**
 * An offset rotated `steps` sixty-degree steps about `(0, 0)`, clockwise for a
 * positive `steps` and counterclockwise for a negative one.
 */
export function rotate(hex: Hex, steps: number): Hex {
  let turned = { q: hex.q, r: hex.r };
  const count = ((steps % 6) + 6) % 6;
  for (let i = 0; i < count; i += 1) turned = rotateCw(turned);
  return turned;
}

/** `hex` rotated `steps` steps about `about`, then left where it lies. */
export function rotateAbout(hex: Hex, about: Hex, steps: number): Hex {
  const turned = rotate({ q: hex.q - about.q, r: hex.r - about.r }, steps);
  return { q: about.q + turned.q, r: about.r + turned.r };
}

/** `hex` translated by `by`. */
export function translate(hex: Hex, by: Hex): Hex {
  return { q: hex.q + by.q, r: hex.r + by.r };
}

/**
 * A pattern hex placed at `anchor` and `rotation`: rotated about `(0, 0)` by the
 * rotation, then translated by the anchor (`specs/field.md`, Molecule patterns).
 */
export function place(pattern: Hex, anchor: Hex, rotation: number): Hex {
  return translate(rotate(pattern, rotation), anchor);
}

/** A direction index turned `steps` steps clockwise, modulo six. */
export function turnDirection(d: number, steps: number): number {
  return (((d + steps) % 6) + 6) % 6;
}

/**
 * The hex the pointer targets at a stage position, or `null` when no field hex
 * center lies within `HEX_HIT_R` (`specs/field.md`, Targeting a hex).
 *
 * "The pointer targets the field hex whose center is nearest to the pointer
 * position, provided that distance is at most `HEX_HIT_R` (`26`). When two or
 * more centers are equidistant, the hex with the smaller `r` wins, then the
 * smaller `q`." Ties are resolved by walking the field in reading order and
 * keeping a candidate only when it is STRICTLY nearer, which is that rule.
 */
export function targetHex(x: number, y: number): Hex | null {
  let best: Hex | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hex of fieldHexes()) {
    const away = distance({ x, y }, hexCenter(hex));
    if (away < bestDistance) {
      best = hex;
      bestDistance = away;
    }
  }
  return best !== null && bestDistance <= HEX_HIT_R ? best : null;
}

/* -------------------------------------------------------------------------- */
/* The editor's regions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Whether a stage position lies inside a rectangle, the lower bounds INCLUDED
 * and the upper bounds EXCLUDED (`specs/editor.md`).
 */
export function contains(region: Region, at_: StagePoint): boolean {
  return (
    at_.x >= region.x &&
    at_.x < region.x + region.w &&
    at_.y >= region.y &&
    at_.y < region.y + region.h
  );
}

/** The middle of a rectangle, which is where a check aims at the thing in it. */
export function regionCenter(region: Region): StagePoint {
  return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
}

/** The heading strip: the challenge's name, the cost, and the messages. */
export const HEADING_REGION: Region = {
  x: 0,
  y: 0,
  w: STAGE_W,
  h: HEADING_H,
};

/** The tray: one slot per available part. */
export const TRAY_REGION: Region = {
  x: 0,
  y: HEADING_H,
  w: TRAY_REGION_W,
  h: STAGE_H - HEADING_H,
};

/** The field: the hex field of `specs/field.md`, drawn at its fixed geometry. */
export const FIELD_REGION: Region = {
  x: TRAY_REGION_W,
  y: HEADING_H,
  w: READOUT_X0 - TRAY_REGION_W,
  h: TAPE_Y0 - HEADING_H,
};

/** The readout: the run's live figures. */
export const READOUT_REGION: Region = {
  x: READOUT_X0,
  y: HEADING_H,
  w: STAGE_W - READOUT_X0,
  h: TAPE_Y0 - HEADING_H,
};

/** The tape panel: one row per arm and wheel. */
export const TAPE_REGION: Region = {
  x: TRAY_REGION_W,
  y: TAPE_Y0,
  w: STAGE_W - TRAY_REGION_W,
  h: STAGE_H - TAPE_Y0,
};

/** The five regions, in the order `specs/editor.md` tabulates them. */
export const EDITOR_REGIONS: readonly Region[] = [
  HEADING_REGION,
  TRAY_REGION,
  FIELD_REGION,
  READOUT_REGION,
  TAPE_REGION,
];

/**
 * Tray entry `k`'s rectangle, from `(TRAY_X0, TRAY_Y0 + k * TRAY_SLOT_H)` to
 * `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)` (`specs/editor.md`).
 */
export function traySlot(k: number): Region {
  return {
    x: TRAY_X0,
    y: TRAY_Y0 + k * TRAY_SLOT_H,
    w: TRAY_W,
    h: TRAY_SLOT_H,
  };
}

/**
 * The rectangle of visible row `v`'s LABEL, `x` `TRAY_REGION_W` to
 * `TRAY_REGION_W + TAPE_LABEL_W` across the row's full height
 * (`specs/editor.md`).
 *
 * `v` is the VISIBLE row, `0` to `TAPE_ROWS_VISIBLE - 1`, not the part's index
 * in placement order: which part a visible row shows depends on `firstRow`,
 * which {@link firstVisibleRow} computes.
 */
export function tapeLabel(v: number): Region {
  return {
    x: TRAY_REGION_W,
    y: TAPE_Y0 + v * TAPE_ROW_H,
    w: TAPE_LABEL_W,
    h: TAPE_ROW_H,
  };
}

/**
 * The rectangle of the cell at visible row `v` and visible column `u`: the
 * columns begin at `TRAY_REGION_W + TAPE_X0` and each is `TAPE_CELL_W` wide
 * (`specs/editor.md`).
 */
export function tapeCell(v: number, u: number): Region {
  return {
    x: TRAY_REGION_W + TAPE_X0 + u * TAPE_CELL_W,
    y: TAPE_Y0 + v * TAPE_ROW_H,
    w: TAPE_CELL_W,
    h: TAPE_ROW_H,
  };
}

/**
 * `firstRow = max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1))`, where
 * `selectedRow` is the cursor's arm's index in placement order, and `0` with no
 * cursor (`specs/editor.md`).
 */
export function firstVisibleRow(selectedRow: number | null): number {
  if (selectedRow === null) return 0;
  return Math.max(0, selectedRow - (TAPE_ROWS_VISIBLE - 1));
}

/**
 * `firstCol = max(0, cursor.col - (TAPE_COLS_VISIBLE - 1))`, and `0` with no
 * cursor (`specs/editor.md`).
 */
export function firstVisibleColumn(cursorColumn: number | null): number {
  if (cursorColumn === null) return 0;
  return Math.max(0, cursorColumn - (TAPE_COLS_VISIBLE - 1));
}

/**
 * Where a press must land to point the cursor at row `row` (in PLACEMENT order)
 * and column `col`, given where the panel is scrolled to.
 *
 * The panel's two scroll positions are derived from the cursor, so a check that
 * wants to press a particular cell states the cursor the panel is showing rather
 * than guessing at the scroll.
 */
export function tapeCellAt(
  row: number,
  col: number,
  scroll: { row: number | null; col: number | null } = { row: null, col: null },
): Region | null {
  const v = row - firstVisibleRow(scroll.row);
  const u = col - firstVisibleColumn(scroll.col);
  if (v < 0 || v >= TAPE_ROWS_VISIBLE) return null;
  if (u < 0 || u >= TAPE_COLS_VISIBLE) return null;
  return tapeCell(v, u);
}
