// Arc Foundry — `screens.victory-screen`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/victory-screen.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The victory screen draws the Maze Rating, the number of
// waves survived (N for the chosen difficulty) and the Grid Integrity
// remaining, and offers PLAY AGAIN and MENU.
//
// HOW IT IS DECIDED. Drive a run to victory and read the text draws and the
// offered choices. The evidence it hands back is `victory` (image): the
// victory screen.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.victory-screen", () => {
  it("The victory screen shows the run's figures", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.victory-screen` has not been written yet",
    );
  });
});
