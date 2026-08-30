// Arc Foundry — `yard.anchor-bounds`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/anchor-bounds.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A placement anchored at col 49 or row 32, or at a negative
// anchor, is refused and changes nothing, because a 2x2 footprint fits only at
// col 0-48 and row 0-31.
//
// HOW IT IS DECIDED. Attempt a placement at each out-of-range anchor and read
// the structure count back. The evidence it hands back is `refused` (image):
// the yard after a refused out-of-bounds placement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.anchor-bounds", () => {
  it("An anchor outside the grid is refused", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.anchor-bounds` has not been written yet",
    );
  });
});
