// Arc Foundry — `yard.tile-centres`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/tile-centres.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure anchored at (col, row) reports its centre at
// (20 * (col + 1), 56 + 20 * (row + 1)), checked at the yard's corners and at
// its middle, so the grid is anchored at (0, 56) with TILE (20) square tiles.
//
// HOW IT IS DECIDED. Stand structures at four spread anchors and hold each
// reported cx and cy against the formula in specs/yard.md. The evidence it
// hands back is `grid` (image): structures standing on the computed tile
// centres.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.tile-centres", () => {
  it("A structure sits on the tile centre the formula gives", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.tile-centres` has not been written yet",
    );
  });
});
