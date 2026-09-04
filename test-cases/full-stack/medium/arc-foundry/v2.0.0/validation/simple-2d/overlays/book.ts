// Arc Foundry — reading the recipe book's own cells. CASE-PROVIDED, LOCAL TO THIS CATEGORY.
//
// WHAT THE BOOK REPORTS. `specs/hud.md` requires every ingredient of every recipe to
// be drawn in one of three states — Selected, Owned, Missing — "told apart at a
// glance", and leaves the book's layout to the build. So `specs/instrumentation.md`
// has the build report every ingredient cell it draws through `recipeEntries`: the
// recipe it belongs to, the ingredient's index within that recipe, its type and
// quality, the state it was drawn in, and the rectangle it was drawn in.
//
// A CHECK THEREFORE DECIDES THE REQUIREMENT IT NAMES. The state comes off the
// reading, which is what `specs/hud.md`'s table fixes; a check asserts that the
// ingredient IT posed changed state and that the others did not, rather than that
// SOMETHING in the book moved.
//
// PIXELS DECIDE ONLY THE HALF THAT IS ABOUT THE PICTURE. "Told apart at a glance" is
// a claim about what the book looks like, so it is read from pixels — but only from
// the pixels of the one reported cell, well inside its rectangle, which is where the
// build said it drew that ingredient. Nothing samples the stage at large any more, so
// no structure standing on the yard behind the overlay can be mistaken for an
// ingredient changing state.

import {
  DISTINCT,
  type Harness,
  lattice,
  type RecipeEntry,
  rgbDistance,
  sample,
} from "../harness";

type Pixel = [number, number, number, number];

/** How finely one reported cell is sampled. */
const STEP = 2;

/** How far inside its own rectangle a cell is sampled, so no edge is read. */
const INSET = 2;

/**
 * The points sampled inside one reported cell.
 *
 * Inset on every side, because a cell's edge is where anti-aliasing and a
 * neighbouring cell's ink live and the requirement is about the cell itself.
 */
export function cellPoints(cell: RecipeEntry): { x: number; y: number }[] {
  return lattice(
    {
      x: cell.x + INSET,
      y: cell.y + INSET,
      w: Math.max(1, cell.w - INSET * 2),
      h: Math.max(1, cell.h - INSET * 2),
    },
    STEP,
  );
}

/** Draw one frame and read the pixels of one reported cell. */
export function readCell(h: Harness, cell: RecipeEntry): Promise<Pixel[]> {
  return sample(h, cellPoints(cell));
}

/**
 * How many of two samplings of the same points read as told apart.
 *
 * `DISTINCT` is this project's own line for something clearly drawn, `50` of the
 * `441` the colour cube spans, and it is the line "told apart at a glance" is held
 * to: two states a player is meant to separate without looking twice have to differ
 * by more than a shade.
 */
export function movedPoints(a: readonly Pixel[], b: readonly Pixel[]): number {
  let moved = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (rgbDistance(a[i]!, b[i]!) > DISTINCT) moved += 1;
  }
  return moved;
}

/** How a cell reads, for a failure that has to name what it found. */
export function describe(entry: RecipeEntry): string {
  return `${entry.combo}[${entry.ingredient}] ${entry.type}@${entry.quality} = ${entry.state}`;
}
