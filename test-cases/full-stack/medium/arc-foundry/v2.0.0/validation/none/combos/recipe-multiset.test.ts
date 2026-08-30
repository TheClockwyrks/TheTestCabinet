// Arc Foundry — `combos.recipe-multiset`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/recipe-multiset.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Singularity calls for arcnode@5, regulator@4,
// rectifier@2 and arcnode@2, so a yard holding one Arc-Node offers no
// Singularity and a yard holding both, at the two different tiers, does.
//
// HOW IT IS DECIDED. Stand the recipe short of its second Arc-Node, read the
// offered actions, add it, and read them again. The evidence it hands back is
// `multiset` (image): the recipe reaching completion on its second Arc-Node.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.recipe-multiset", () => {
  it("A recipe counts its ingredients as a multiset", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.recipe-multiset` has not been written yet",
    );
  });
});
