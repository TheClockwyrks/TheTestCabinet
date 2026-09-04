// Arc Foundry — reading one ingredient cell of the recipe book. CASE-PROVIDED,
// LOCAL TO THIS CATEGORY.
//
// WHAT THE BUILD REPORTS, AND WHY THAT IS WHAT DECIDES. `specs/hud.md` requires
// every ingredient of every recipe to be drawn in one of three states — SELECTED,
// OWNED, MISSING — "told apart at a glance", and leaves the book's layout to the
// build. So `specs/instrumentation.md` has the build report the layout it chose:
// `recipeEntries` returns one entry per ingredient cell, naming the recipe, the
// ingredient's index within it, its type and quality, the state the build drew it
// in, and the rectangle it drew it at.
//
// THE REQUIREMENT SPLITS IN TWO, AND EACH HALF IS READ WHERE IT LIVES.
//
//   WHICH STATE the cell is in is the game's own answer, and it is read off the
//   report. That is the half a pixel comparison could never decide: a build that
//   changed ANY pixel of the book between two poses — a row highlight, a header, an
//   unrelated ingredient — moved something, and "something moved" is not "this
//   ingredient is owned".
//
//   TOLD APART AT A GLANCE is about the picture, so it is read from pixels — and
//   only from the pixels of the reported cell, which is the one rectangle the
//   claim is about. Two states drawn identically inside that rectangle are two
//   states a player cannot tell apart, whatever else the overlay did.

import {
  DISTINCT,
  type Harness,
  lattice,
  type RecipeEntry,
  rgbDistance,
  sample,
} from "../harness";

type Pixel = [number, number, number, number];

/** How finely a reported cell is sampled. Small enough to land inside a chip. */
const STEP = 2;

/**
 * The colours the build drew inside one reported cell.
 *
 * The rectangle is the build's own, so the sampling follows it: a cell drawn
 * eight units square is read at eight units square, and a build that draws its
 * chips large is not read any more finely than one that draws them small.
 */
export async function cellPixels(
  h: Harness,
  cell: RecipeEntry,
): Promise<Pixel[]> {
  return sample(
    h,
    lattice({ x: cell.x, y: cell.y, w: cell.w, h: cell.h }, STEP),
  );
}

/** How many of a cell's sampled points read differently between two poses. */
export function movedPoints(a: readonly Pixel[], b: readonly Pixel[]): number {
  let moved = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (rgbDistance(a[i]!, b[i]!) > DISTINCT) moved += 1;
  }
  return moved;
}
