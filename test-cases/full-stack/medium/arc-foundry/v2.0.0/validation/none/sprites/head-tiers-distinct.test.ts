// Arc Foundry — `sprites.head-tiers-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/head-tiers-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The five head sprites of each base type are pairwise
// different images, so the ladder a player is told to read on sight is drawn
// rather than tinted from one file copied five times.
//
// HOW IT IS DECIDED. Decode each type's five heads and compare their pixels
// pairwise. The evidence it hands back is `ladder` (image): one type across
// its five tiers.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.head-tiers-distinct", () => {
  it("A type's five tiers are five different images", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.head-tiers-distinct` has not been written yet",
    );
  });
});
