// Arc Foundry — `input.back-previous-screen`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-previous-screen.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On any other screen the back action returns to the previous
// one: from the difficulty select to the map select, from the map select to
// the title, and from the how-to screen to the title.
//
// HOW IT IS DECIDED. Take back from each of the three screens in turn and read
// where each landed. The evidence it hands back is `back` (image): the screen
// the back action returned to.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-previous-screen", () => {
  it("back returns to the previous screen elsewhere", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-previous-screen` has not been written yet",
    );
  });
});
