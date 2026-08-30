// Arc Foundry — `abilities.coil-leap-cap`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/coil-leap-cap.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A chain takes at most COIL_LEAPS[tier] additional leaps — 2
// at Scrap and Tuned, 3 at Charged and Primed, 4 at Tesla-Prime — so a line
// longer than the cap leaves its far units untouched.
//
// HOW IT IS DECIDED. Park a line of eight frozen units in leap range and fire
// one shot at each tier. The evidence it hands back is `cap` (replay): the
// units beyond the leap cap left untouched.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.coil-leap-cap", () => {
  it("The chain stops at COIL_LEAPS additional leaps", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.coil-leap-cap` has not been written yet",
    );
  });
});
