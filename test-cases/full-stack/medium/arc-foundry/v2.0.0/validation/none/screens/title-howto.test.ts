// Arc Foundry — `screens.title-howto`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/title-howto.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking HOW TO PLAY from the title moves the screen to
// howto.
//
// HOW IT IS DECIDED. Reset, highlight HOW TO PLAY, confirm it, and read the
// screen. The evidence it hands back is `howto` (image): the how-to screen
// reached from the title.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.title-howto", () => {
  it("HOW TO PLAY leads to the how-to screen", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.title-howto` has not been written yet",
    );
  });
});
