// Arc Foundry — `combos.recipe-incomplete-refused`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/recipe-incomplete-refused.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A yard missing any one ingredient of a recipe offers no
// COMBINE SPECIAL for that tower, and a combine committed on a would-be
// ingredient does not build it.
//
// HOW IT IS DECIDED. Stand a recipe one ingredient short, read the offered
// actions, and attempt the combine. The evidence it hands back is `refused`
// (image): the incomplete recipe offering no fold.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.recipe-incomplete-refused", () => {
  it("An incomplete recipe offers no fold", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.recipe-incomplete-refused` has not been written yet",
    );
  });
});
