// Arc Foundry — `screens.mapselect-back`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/mapselect-back.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking the BACK entry from the map select moves the screen
// to title.
//
// HOW IT IS DECIDED. Open the map select, take BACK, and read the screen. The
// evidence it hands back is `title` (image): the title returned to from the
// map select.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.mapselect-back", () => {
  it("The map select's BACK returns to the title", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.mapselect-back` has not been written yet",
    );
  });
});
