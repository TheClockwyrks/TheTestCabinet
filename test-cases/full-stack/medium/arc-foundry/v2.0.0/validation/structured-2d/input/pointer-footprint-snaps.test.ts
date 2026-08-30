// Arc Foundry — `input.pointer-footprint-snaps`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-footprint-snaps.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Moving the pointer over the yard while holding a rock snaps
// the held footprint to the tile under it and updates its legal read, so the
// reported held col and row are the tile the pointer is over.
//
// HOW IT IS DECIDED. Arm a rock, move the pointer to several known tile
// centres, and read the held col, row and legal flag. The evidence it hands
// back is `snap` (image): the held footprint snapped to the grid.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-footprint-snaps", () => {
  it("A held footprint snaps to the tile under the pointer", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-footprint-snaps` has not been written yet",
    );
  });
});
