// Arc Foundry — `input.back-overlay`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-overlay.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With nothing held and nothing selected, the back action
// closes an open overlay and leaves the screen on playing.
//
// HOW IT IS DECIDED. Open the recipe book with nothing held or selected, take
// back once, and read the overlays and the screen. The evidence it hands back
// is `back` (image): the overlay the back action closed.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-overlay", () => {
  it("back closes an open overlay next", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-overlay` has not been written yet",
    );
  });
});
