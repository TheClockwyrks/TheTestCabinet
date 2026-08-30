// Arc Foundry — `combos.recipe-assembles`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/recipe-assembles.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combine committed over the exact multiset of base (type,
// tier) ingredients a recipe names produces that combination tower at the
// initiating footprint, with no quality tier and the reference stat block
// scaled to its level.
//
// HOW IT IS DECIDED. Stand the Static Web's three ingredients, combine, and
// read the resulting structure back. The evidence it hands back is `assemble`
// (image): the combination tower the recipe built.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.recipe-assembles", () => {
  it("A recipe folds into its combination tower", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.recipe-assembles` has not been written yet",
    );
  });
});
