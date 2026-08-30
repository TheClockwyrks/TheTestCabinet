// Arc Foundry — `yard.footprint-covers-four`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/footprint-covers-four.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure anchored at (col, row) covers tiles col..col+1
// by row..row+1 and no others: a second placement overlapping any one of those
// four is refused, and one anchored at (col + 2, row) is accepted.
//
// HOW IT IS DECIDED. Stand a structure, then attempt each of the four
// overlapping anchors and the clear one beside them. The evidence it hands
// back is `footprint` (image): the 2x2 footprint and the accepted neighbor.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.footprint-covers-four", () => {
  it("A structure walls exactly its four tiles", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.footprint-covers-four` has not been written yet",
    );
  });
});
