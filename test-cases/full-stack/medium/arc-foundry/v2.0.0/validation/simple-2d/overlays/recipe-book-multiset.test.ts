// Arc Foundry — `overlays.recipe-book-multiset`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/recipe-book-multiset.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A recipe calling for two ingredients at the same type and
// quality reads as covered only when the yard holds two of them, so one reads
// the second as missing.
//
// HOW IT IS DECIDED. Stand one, then two, of a doubled ingredient and sample
// it in the book after each. The evidence it hands back is `multiset` (image):
// the doubled ingredient covered only by two.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.recipe-book-multiset", () => {
  it("Ownership counts as a multiset", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.recipe-book-multiset` has not been written yet",
    );
  });
});
