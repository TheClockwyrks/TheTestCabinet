// Arc Foundry — `screens.difficultyselect-lists-three`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/difficultyselect-lists-three.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The difficulty select draws Easy, Medium and Hard, each
// with its wave count and how tough its Load grows, before one is chosen.
//
// HOW IT IS DECIDED. Open the difficulty select and read the text draws. The
// evidence it hands back is `difficulty` (image): the difficulty select and
// its figures.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.difficultyselect-lists-three", () => {
  it("The difficulty select shows each difficulty's figures", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.difficultyselect-lists-three` has not been written yet",
    );
  });
});
