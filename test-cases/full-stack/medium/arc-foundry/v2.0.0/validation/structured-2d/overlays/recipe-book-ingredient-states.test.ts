// Arc Foundry — `overlays.recipe-book-ingredient-states`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/recipe-book-ingredient-states.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Each ingredient of each recipe is drawn in one of three
// states, told apart by more than 50 of 441 in RGB distance at the sampled
// ingredient: selected when the current selection is a base structure at that
// type and quality, owned when the yard holds one that is not the selection,
// and missing otherwise.
//
// HOW IT IS DECIDED. Pose a yard holding one ingredient, select it, and sample
// the same ingredient across the three states. The evidence it hands back is
// `states` (image): the three ingredient states.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.recipe-book-ingredient-states", () => {
  it("An ingredient reads selected, owned or missing", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.recipe-book-ingredient-states` has not been written yet",
    );
  });
});
