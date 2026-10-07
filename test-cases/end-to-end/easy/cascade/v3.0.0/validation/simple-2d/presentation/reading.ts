// presentation/reading — which pixels this group's comparisons are taken over.
//
// Only the presentation points read a frame this way, so this lives beside them
// rather than in the shared harness next door. Like everything there it fixes a
// READING alone — which pixels a comparison is taken over — and never a
// THRESHOLD.
//
// NOTHING HERE KNOWS A COLOUR, AND NOTHING HERE MEASURES ONE. specs/overview.md
// fixes no palette, no typeface and no layout, and leaves the palette, the type
// and every other aspect of the look to the build, so how a build's picture LOOKS
// is the reviewer's to judge. Every reading below therefore answers one question:
// did what the build painted here change when the thing under test was posed. A
// difference of any size is a yes and no difference is a no. No figure here is a
// hex value, and no point in this directory holds a build's colours to a bar: the
// figures the points do carry bound two readings of the SAME thing against the
// rasterizer's own noise, which only ever makes a comparison weaker.

import { CARD_H, CARD_W, STAGE_H, STAGE_W, type Rect } from "../constants";
import {
  colorDistance,
  pixelColor,
  sampleGrid,
  type Harness,
  type Rgb,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a card is read                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far inside its own footprint a card is read, in logical units.
 *
 * A card is a `CARD_W x CARD_H` footprint (specs/table.md) and a build is free to
 * finish its edge however it likes — an inset stroke, a rounded corner, a drop
 * shadow. None of that is what "a card reads apart from the table" is about, and
 * a corner that rounds away to felt would drag felt into a reading of the card,
 * so every card reading is taken inside this margin. It is small next to the
 * `100 x 140` footprint it insets, so what is read is still the card.
 */
const CARD_MARGIN = 8;

/** How finely a card's interior is sampled: `COLS x ROWS` points over it. */
export const CARD_COLS = 40;
export const CARD_ROWS = 56;

/** The interior of the card drawn at a top-left, as a rectangle. */
function cardInterior(x: number, y: number): Rect {
  return {
    x: x + CARD_MARGIN,
    y: y + CARD_MARGIN,
    w: CARD_W - 2 * CARD_MARGIN,
    h: CARD_H - 2 * CARD_MARGIN,
  };
}

/**
 * The colours the card drawn at a top-left was painted in, row by row.
 *
 * Two grids taken this way over two frames are directly comparable cell for cell,
 * because the grid is a function of the top-left alone: a check that poses one
 * card, reads it, poses another at the same anchor and reads that one is
 * comparing the same points of the same footprint.
 */
export function cardSamples(h: Harness, x: number, y: number): Rgb[] {
  return sampleGrid(h, cardInterior(x, y), CARD_COLS, CARD_ROWS);
}

/**
 * A lattice of one sample per whole logical unit of a rectangle.
 *
 * WHY SOME READINGS NEED THE UNIT PITCH. A grid of a few thousand cells over a
 * card samples it every two or three units, which is fine for asking what colour
 * a region comes to as a whole and wrong for asking whether a MARK is there: the
 * specification fixes no line width, so a build may draw its empty-slot outline
 * or its rank in strokes one unit wide — one device pixel at this window size —
 * and a lattice coarser than the pixel does not merely measure such a stroke
 * badly, it steps between its rows and reports a hairline mark exactly as it
 * reports no mark at all. So every reading that looks for a mark, or for the
 * difference between two marks, reads at unit pitch, which is the pitch the
 * engineless suite reads at; the three suites then hold one physical figure.
 *
 * A share of the cells is a share of the rectangle either way, so a threshold
 * stated as a share is an AREA and does not move with the pitch.
 */
export interface UnitGrid {
  /** The rectangle to sample, shifted so the cells' middles land on whole units. */
  rect: Rect;
  cols: number;
  rows: number;
  /** How many cells it holds, which is what a share of it is taken over. */
  cells: number;
}

/** The unit lattice covering `rect`: one cell per whole unit of it. */
export function unitGrid(rect: Rect): UnitGrid {
  const cols = Math.max(1, Math.round(rect.w));
  const rows = Math.max(1, Math.round(rect.h));
  return {
    rect: { x: rect.x - 0.5, y: rect.y - 0.5, w: cols, h: rows },
    cols,
    rows,
    cells: cols * rows,
  };
}

/** The colours the cells of a unit lattice were painted in, row by row. */
export function sampleUnitGrid(h: Harness, grid: UnitGrid): Rgb[] {
  return sampleGrid(h, grid.rect, grid.cols, grid.rows);
}

/**
 * A card's interior, at unit pitch, as the rank and suit points read it.
 *
 * Stated at the origin and shifted to the anchor by {@link cardFaceSamples}, so
 * the cell count a share is taken over is one figure the checks can name.
 */
export const FACE = unitGrid(cardInterior(0, 0));

/**
 * The colours the card drawn at a top-left was painted in, at unit pitch.
 *
 * Comparable cell for cell with another reading taken at the same top-left, for
 * the same reason `cardSamples` is: the lattice is a function of the top-left
 * alone.
 */
export function cardFaceSamples(h: Harness, x: number, y: number): Rgb[] {
  return sampleUnitGrid(h, unitGrid(cardInterior(x, y)));
}

/* -------------------------------------------------------------------------- */
/* Comparing what was painted                                                 */
/* -------------------------------------------------------------------------- */

/** The largest distance between two grids of samples, cell for cell. */
export function maxDistance(a: readonly Rgb[], b: readonly Rgb[]): number {
  let most = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    most = Math.max(most, colorDistance(a[i], b[i]));
  }
  return most;
}

/**
 * The cells at which two grids of the same footprint were painted differently.
 *
 * The same drawing operations produce the same
 * buffer here, so two frames posed to differ in one thing differ at exactly the cells
 * that thing touched, and "differently" is any difference at all. There is no
 * noise to hold off and so no threshold to state: how far apart the two paintings
 * sit is appearance, which the reviewer judges.
 */
export function differingCells(a: readonly Rgb[], b: readonly Rgb[]): number[] {
  const found: number[] = [];
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    if (colorDistance(a[i], b[i]) > 0) found.push(i);
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Reading one point                                                          */
/* -------------------------------------------------------------------------- */

/** The colour a single logical point was painted, clamped to the stage. */
export function pointColor(h: Harness, x: number, y: number): Rgb {
  return pixelColor(
    h,
    Math.max(0, Math.min(x, STAGE_W - 1)),
    Math.max(0, Math.min(y, STAGE_H - 1)),
  );
}
