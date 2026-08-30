// Arc Foundry — `overlays.recipe-book-blockers-not-owned`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `overlays/recipe-book-blockers-not-owned.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A blocker and a combination tower never satisfy an
// ingredient: a yard holding a blocker where a recipe wants a Capacitor reads
// that ingredient as missing.
//
// HOW IT IS DECIDED. Stand a blocker and a tower on an otherwise empty yard
// and sample the ingredients they might be mistaken for. The evidence it hands
// back is `book` (image): the recipe book with nothing owned.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("overlays.recipe-book-blockers-not-owned", () => {
  it("Blockers and towers never count as owned", () => {
    fail(
      "a validator deciding this point",
      "the suite for `overlays.recipe-book-blockers-not-owned` has not been written yet",
    );
  });
});
