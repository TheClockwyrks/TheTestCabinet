// presentation/reading — which pixels this group's comparisons are taken over.
//
// Only the presentation points read a frame this way, so this lives beside them
// rather than in the shared harness next door. Like everything there it fixes a
// READING alone — which pixels a comparison is taken over — and never a
// THRESHOLD.
//
// NOTHING HERE KNOWS A COLOUR, AND NOTHING HERE MEASURES ONE.
// `specs/overview.md` fixes no palette, no typeface and no layout, and closes
// with "The palette, the type, and every other aspect of the look are yours", so
// how a build's picture LOOKS is the reviewer's to judge. Every reading below
// therefore answers one question: did what the build painted here change when the
// thing under test was posed. A difference of any size is a yes and no difference
// is a no. No figure here is a hex value, and no point in this directory holds a
// build's colours to a bar: the figures the points do carry bound two readings of
// the SAME thing against the rasterizer's own noise, which only ever makes a
// comparison weaker.
//
// EVERY READING CROSSES INTO THE PAGE, because under this engine the picture is
// on a canvas in a browser rather than on one this process holds: a grid is one
// `Harness.pixels` crossing, whatever its size, and the frame it reads is
// whichever frame ran last. So take a grid after the frame that poses the thing
// under test and before the next one is driven.

import { CARD_H, CARD_W } from "../constants";
import {
  colorDistance,
  gridPoints,
  type Harness,
  type Rect,
  type Rgb,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Sampling a region                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The colours a logical rectangle was painted in, as a `cols x rows` grid read
 * row by row, top row first.
 *
 * Each cell is the pixel at the middle of its own share of the rectangle, so the
 * grid is a function of the RECTANGLE alone: two grids taken over the same
 * rectangle in two frames are directly comparable cell for cell, and cell
 * `row * cols + col` is the same place in both.
 */
export async function sampleGrid(
  h: Harness,
  rect: Rect,
  cols: number,
  rows: number,
): Promise<Rgb[]> {
  const read = await h.pixels(gridPoints(rect, cols, rows));
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/**
 * A rectangle and a grid shape that sample every whole unit of it, once each.
 *
 * WHY A READING EVER NEEDS THIS. The harness maps one logical unit onto one
 * device pixel, so a build that draws a mark ONE unit wide draws one pixel wide,
 * and a coarser grid does not merely estimate such a mark badly — it can miss it
 * entirely and systematically. A `40 x 56` grid over a `100 x 140` footprint puts
 * its first column's middle at `x + 1.25`: an outline stroked along the
 * footprint's own edge covers `x - 0.5` to `x + 0.5` and is never sampled at all,
 * in any row. The reading would then report a build that drew a hairline outline
 * exactly as it reports one that drew nothing.
 *
 * `specs/table.md` fixes no form and no weight for the marks this matters to —
 * an empty pile's "card-sized mark", and the highlight `specs/controls.md` puts
 * under a held run — so a hairline is a shape the specification allows and a
 * reading has to be able to see. Sampling the integer lattice sees it: the middle
 * of every cell lands on a whole unit, so a mark one unit wide lands on cells
 * rather than between them.
 *
 * A share taken over this grid means the same area it meant over a coarser one,
 * because a share of the CELLS is a share of the RECTANGLE either way. What
 * changes is only how finely that share is resolved.
 *
 * It is not the default for every reading here: a mean over a card, or a
 * comparison of two whole card paintings, is a reading of a FIELD rather than of
 * a mark, and resolving it to the unit costs a crossing several times over for a
 * figure that does not move.
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
export function sampleUnitGrid(h: Harness, grid: UnitGrid): Promise<Rgb[]> {
  return sampleGrid(h, grid.rect, grid.cols, grid.rows);
}

/**
 * The indices of the cells of a `cols x rows` grid over `rect` whose own middle
 * lies OUTSIDE `exclude` — the part of a rectangle a player can still see when
 * something has been drawn over the rest of it.
 *
 * The one point that needs it is `drop-highlight-visible`, where the held run
 * covers part of the pile it is over and only the uncovered part of that pile
 * can carry a highlight a player reads.
 */
export function cellsOutside(
  rect: Rect,
  cols: number,
  rows: number,
  exclude: Rect,
): number[] {
  const kept: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = rect.y + ((row + 0.5) * rect.h) / rows;
    for (let col = 0; col < cols; col += 1) {
      const x = rect.x + ((col + 0.5) * rect.w) / cols;
      const inside =
        x >= exclude.x &&
        x <= exclude.x + exclude.w &&
        y >= exclude.y &&
        y <= exclude.y + exclude.h;
      if (!inside) kept.push(row * cols + col);
    }
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Where a card is read                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How far inside its own footprint a card is read, in logical units.
 *
 * A card is a `CARD_W x CARD_H` footprint (`specs/table.md`) and a build is free
 * to finish its edge however it likes — an inset stroke, a rounded corner, a
 * drop shadow. None of that is what "a card reads apart from the table" is
 * about, and a corner that rounds away to felt would drag felt into a reading of
 * the card, so every card reading is taken inside this margin. It is small next
 * to the `100 x 140` footprint it insets, so what is read is still the card.
 */
export const CARD_MARGIN = 8;

/** How finely a card's interior is sampled: `COLS x ROWS` points over it. */
export const CARD_COLS = 40;
export const CARD_ROWS = 56;

/** The interior of the card drawn at a top-left, as a rectangle. */
export function cardInterior(x: number, y: number): Rect {
  return {
    x: x + CARD_MARGIN,
    y: y + CARD_MARGIN,
    w: CARD_W - 2 * CARD_MARGIN,
    h: CARD_H - 2 * CARD_MARGIN,
  };
}

/** The colours the card drawn at a top-left was painted in, row by row. */
export function cardSamples(h: Harness, x: number, y: number): Promise<Rgb[]> {
  return sampleGrid(h, cardInterior(x, y), CARD_COLS, CARD_ROWS);
}

/* -------------------------------------------------------------------------- */
/* Comparing what was painted                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The largest distance between two grids of samples, cell for cell.
 *
 * `cells` narrows the comparison to the cells a point can read — the part of a
 * pile a held run does not cover — and defaults to all of them.
 */
export function maxDistance(
  a: readonly Rgb[],
  b: readonly Rgb[],
  cells?: readonly number[],
): number {
  const indices =
    cells ?? Array.from({ length: Math.min(a.length, b.length) }, (_, i) => i);
  return indices.reduce(
    (most, i) => Math.max(most, colorDistance(a[i], b[i])),
    0,
  );
}

/**
 * The cells at which two grids of the same footprint were painted differently.
 *
 * Rendering is deterministic here — the same drawing operations produce the same
 * buffer — so two frames posed to differ in one thing differ at exactly the cells
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
