// Arc Foundry — `screens.difficultyselect-starts`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/difficultyselect-starts.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking a difficulty from the difficulty select moves the
// screen to playing on the chosen map at that difficulty, in its first build
// phase.
//
// HOW IT IS DECIDED. Choose a map and a difficulty from the menus and read the
// screen, phase, map and difficulty. The evidence it hands back is `run`
// (image): the run begun from the menus.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.difficultyselect-starts", () => {
  it("Choosing a difficulty begins the run", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.difficultyselect-starts` has not been written yet",
    );
  });
});
