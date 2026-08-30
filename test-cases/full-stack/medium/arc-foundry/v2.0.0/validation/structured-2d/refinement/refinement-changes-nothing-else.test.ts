// Arc Foundry — `refinement.refinement-changes-nothing-else`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/refinement-changes-nothing-else.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Buying refinement leaves every standing structure's damage,
// range, fire rate and abilities untouched, leaves Grid Integrity and the
// stamp allowance where they were, and changes no tile.
//
// HOW IT IS DECIDED. Stand a spread of structures, refine, and compare every
// reported stat before and after. The evidence it hands back is `unchanged`
// (image): the yard unchanged across a refinement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.refinement-changes-nothing-else", () => {
  it("Refinement changes only the quality distribution", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.refinement-changes-nothing-else` has not been written yet",
    );
  });
});
