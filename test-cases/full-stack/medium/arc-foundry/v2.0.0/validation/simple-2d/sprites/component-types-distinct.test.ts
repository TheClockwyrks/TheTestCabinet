// Arc Foundry — `sprites.component-types-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/component-types-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At a fixed tier the eight base types' head sprites are
// pairwise different images, so each type reads as its own type.
//
// HOW IT IS DECIDED. Decode the eight heads at one tier and compare their
// pixels pairwise. The evidence it hands back is `types` (image): the eight
// base types side by side.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.component-types-distinct", () => {
  it("The eight base types are eight different images", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.component-types-distinct` has not been written yet",
    );
  });
});
