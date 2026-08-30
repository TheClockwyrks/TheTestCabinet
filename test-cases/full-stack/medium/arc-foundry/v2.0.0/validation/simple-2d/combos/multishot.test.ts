// Arc Foundry — `combos.multishot`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/multishot.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A tower carrying multishot(N) launches one projectile at
// each of up to N distinct in-range units on each cadence, choosing the top N
// by its targeting priority, so a Fork Array with five units in range puts
// three projectiles at three different targets on the frame it fires and only
// one when a single unit is in range.
//
// HOW IT IS DECIDED. Park five frozen units in range of a Fork Array, advance
// to one cadence, and read the projectiles and their targets. The evidence it
// hands back is `fork` (replay): the three shots a Fork Array launched.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.multishot", () => {
  it("A multishot fires at N distinct targets at once", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.multishot` has not been written yet",
    );
  });
});
