// Arc Foundry — `screens.overload-screen`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/overload-screen.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The overload screen draws the wave the run reached and no
// Maze Rating, and offers TRY AGAIN and MENU.
//
// HOW IT IS DECIDED. Lose a run mid-campaign and read the text draws and the
// offered choices. The evidence it hands back is `overload` (image): the
// overload screen.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.overload-screen", () => {
  it("The overload screen shows the wave reached and no rating", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.overload-screen` has not been written yet",
    );
  });
});
