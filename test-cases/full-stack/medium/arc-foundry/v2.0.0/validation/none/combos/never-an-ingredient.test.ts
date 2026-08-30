// Arc Foundry — `combos.never-an-ingredient`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/never-an-ingredient.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combination tower cannot be quality-combined and never
// satisfies a recipe: two identical towers offer no fold, and a recipe calling
// for a base component is not satisfied by a tower built from that component.
//
// HOW IT IS DECIDED. Stand two identical towers, read the offered actions, and
// attempt a combine on each. The evidence it hands back is `refused` (image):
// the pair of towers that offers no fold.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.never-an-ingredient", () => {
  it("A combination tower is never an ingredient", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.never-an-ingredient` has not been written yet",
    );
  });
});
