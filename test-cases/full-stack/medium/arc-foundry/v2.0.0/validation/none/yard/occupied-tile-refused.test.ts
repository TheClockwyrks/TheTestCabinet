// Arc Foundry — `yard.occupied-tile-refused`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/occupied-tile-refused.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A placement whose footprint any live Load unit currently
// occupies is refused and changes nothing, and the same placement is accepted
// once that unit has been cleared.
//
// HOW IT IS DECIDED. Park a unit on a footprint, attempt the placement, clear
// the unit and attempt it again. The evidence it hands back is `refused`
// (image): the refused placement under a standing unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.occupied-tile-refused", () => {
  it("A placement under a standing unit is refused", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.occupied-tile-refused` has not been written yet",
    );
  });
});
