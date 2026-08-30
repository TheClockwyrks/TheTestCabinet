// Arc Foundry — `screens.title-salvage`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/title-salvage.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking SALVAGE from the title moves the screen to
// mapselect.
//
// HOW IT IS DECIDED. Reset, highlight SALVAGE, confirm it, and read the
// screen. The evidence it hands back is `mapselect` (image): the map select
// reached from the title.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.title-salvage", () => {
  it("SALVAGE leads to the map select", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.title-salvage` has not been written yet",
    );
  });
});
