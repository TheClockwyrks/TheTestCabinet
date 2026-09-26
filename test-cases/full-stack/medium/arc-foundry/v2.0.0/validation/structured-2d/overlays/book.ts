// Arc Foundry — reading the recipe book's ingredient cells. CASE-PROVIDED, LOCAL
// TO THIS CATEGORY.
//
// WHAT THE BUILD REPORTS, AND WHAT IS LEFT TO READ OFF THE PIXELS.
// `specs/hud.md` requires every ingredient of every recipe to be drawn in one of
// three states — Selected, Owned, Missing — "told apart at a glance", and it
// leaves the book's layout to the build. So there are two halves to the
// requirement, and each is decided from the reading that answers it:
//
//   * WHICH STATE the build put a cell in is the game's own state, and
//     `specs/instrumentation.md`'s `recipeEntries` reports it directly, per cell,
//     alongside the recipe it belongs to, the ingredient's index within that
//     recipe, its type and quality, and the rectangle the cell was drawn at. That
//     is a state read, so it is the reading a check uses.
//   * TOLD APART AT A GLANCE is about the picture, so it is the one half that is
//     decided from pixels — and only ever inside the rectangle the build reported
//     for the cell in question, so what is compared is that cell rather than
//     whatever else the pose moved on the yard or elsewhere in the book.
//
// Before `recipeEntries` existed this file guessed the book's extent with a
// double-difference mask over the whole stage, and could only say that SOMETHING
// on the overlay moved — which a header, a row highlight, or an unrelated
// ingredient satisfies just as well as the cell the check names. The reported
// rectangle removes the guess.

import {
  DRAWN,
  type Harness,
  lattice,
  recipeCell,
  type RecipeEntry,
  rgbDistance,
} from "../harness";
import type { ComboId } from "../constants";

type Pixel = [number, number, number, number];

/**
 * How finely a cell is sampled. Small enough to land several points inside an
 * ingredient chip of any plausible size.
 */
const STEP = 3;

/** How many sampled points of a cell have to move for two states to read apart. */
export const APART = 1;

/** Open the recipe book, which `specs/hud.md` makes a read-only overlay. */
export function openBook(h: Harness): void {
  h.debug.setOverlay("combos", true);
}

/** One cell of one recipe, as the build reported it with the book open. */
export function cell(
  h: Harness,
  combo: ComboId,
  ingredient: number,
): RecipeEntry {
  return recipeCell(h, combo, ingredient);
}

/**
 * The colours inside one reported cell rectangle, on the frame that follows.
 *
 * The rectangle is re-read at every call, because `specs/hud.md` lets the book's
 * layout be the build's and says nothing that forbids it moving between poses.
 */
export async function cellPixels(
  h: Harness,
  combo: ComboId,
  ingredient: number,
): Promise<Pixel[]> {
  // The book reports the cells of the frame it was last drawn on
  // (`specs/instrumentation.md`), so the frame is drawn first and the pixels read
  // off that same frame.
  await h.advance(1);
  const rect = cell(h, combo, ingredient);
  return h.pixels(lattice(rect, STEP));
}

/** How many of two samplings of a cell read as told apart. */
export function movedPoints(a: readonly Pixel[], b: readonly Pixel[]): number {
  let moved = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (rgbDistance(a[i]!, b[i]!) > DRAWN) moved += 1;
  }
  return moved;
}
