// Arc Foundry — `sprites.produced-sprites-are-drawn`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/produced-sprites-are-drawn.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A frame drawn with a component standing on the yard draws
// an image inside that component's footprint, so the produced files are what
// the yard is drawn from rather than sitting unused beside a code-drawn game.
//
// HOW IT IS DECIDED. Stand a component, render one frame, and read the image
// draws whose destination covers its footprint. The evidence it hands back is
// `drawn` (image): the component drawn from its produced sprite.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.produced-sprites-are-drawn", () => {
  it("The build draws the sprites it produced", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.produced-sprites-are-drawn` has not been written yet",
    );
  });
});
