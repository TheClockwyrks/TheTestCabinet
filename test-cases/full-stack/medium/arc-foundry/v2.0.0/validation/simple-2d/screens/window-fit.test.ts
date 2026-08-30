// Arc Foundry — `screens.window-fit`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/window-fit.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Over surfaces wider than the stage, taller than it, and at
// a raised device pixel ratio, the whole 1280x720 stage is inside the surface
// with its aspect ratio preserved and the letterboxing even, and the bars
// carry the stage's background color, within an RGB distance of 25 of 441 from
// a sampled empty patch of the stage's own background. The fit is read on the
// first frame before any input.
//
// HOW IT IS DECIDED. Build the game over several differently shaped surfaces,
// read the viewport back, and sample the bar pixels against the background.
// The evidence it hands back is `fit` (image): the stage fitted and centred in
// an off-aspect window.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.window-fit", () => {
  it("The stage fits every window", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.window-fit` has not been written yet",
    );
  });
});
