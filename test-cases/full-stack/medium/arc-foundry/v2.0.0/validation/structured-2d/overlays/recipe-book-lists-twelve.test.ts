// Arc Foundry — `overlays.recipe-book-lists-twelve`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/recipe-book-lists-twelve.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The recipe book draws every one of the twelve combination
// towers with its exact recipe and its headline stats.
//
// HOW IT IS DECIDED. Open the recipe book and read its text draws against
// COMBOS. The evidence it hands back is `book` (image): the recipe book.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.recipe-book-lists-twelve", () => {
  it("The recipe book lists all twelve towers", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.recipe-book-lists-twelve` has not been written yet",
    );
  });
});
