// Arc Foundry — `screens.difficultyselect-back`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/difficultyselect-back.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking the BACK entry from the difficulty select moves the
// screen to mapselect.
//
// HOW IT IS DECIDED. Open the difficulty select, take BACK, and read the
// screen. The evidence it hands back is `mapselect` (image): the map select
// returned to.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.difficultyselect-back", () => {
  it("The difficulty select's BACK returns to the map select", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.difficultyselect-back` has not been written yet",
    );
  });
});
