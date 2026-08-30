// Arc Foundry — `press.type-uniform`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/type-uniform.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Over a long run of rolls at a fixed seed every one of the
// eight base types appears, and no type takes more than a quarter of the
// draws, so the type axis is uniform at 0.125 each and refinement does not
// bias it.
//
// HOW IT IS DECIDED. Roll several hundred rocks at a fixed seed and count the
// types. The evidence it hands back is `spread` (image): the yard of rolled
// types.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.type-uniform", () => {
  it("The type roll is uniform over the eight base types", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.type-uniform` has not been written yet",
    );
  });
});
