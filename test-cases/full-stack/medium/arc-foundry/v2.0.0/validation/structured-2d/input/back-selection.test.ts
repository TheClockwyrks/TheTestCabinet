// Arc Foundry — `input.back-selection`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-selection.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With nothing held and a structure selected, the back action
// clears the selection and leaves the overlays and the screen alone.
//
// HOW IT IS DECIDED. Select a structure with an overlay open, take back once,
// and read the selection, the overlays and the screen. The evidence it hands
// back is `back` (image): the selection the back action cleared.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-selection", () => {
  it("back clears the selection next", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-selection` has not been written yet",
    );
  });
});
