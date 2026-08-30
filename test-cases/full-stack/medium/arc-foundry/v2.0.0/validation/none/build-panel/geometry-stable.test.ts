// Arc Foundry — `build-panel.geometry-stable`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/geometry-stable.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A wave starting, Charge accruing and being spent, a
// combinable partner appearing on the yard, and a candidate reaching Tesla-
// Prime all leave every reported panel rectangle exactly where it was,
// changing only which controls are disabled.
//
// HOW IT IS DECIDED. Select a structure, read every rectangle, take each of
// those four state changes, and compare the rectangles after each. The
// evidence it hands back is `panel` (image): the panel's geometry across four
// state changes.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.geometry-stable", () => {
  it("No change in game state moves a panel control", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.geometry-stable` has not been written yet",
    );
  });
});
