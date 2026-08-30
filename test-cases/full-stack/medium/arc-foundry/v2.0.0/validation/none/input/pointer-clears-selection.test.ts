// Arc Foundry — `input.pointer-clears-selection`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-clears-selection.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing on a stretch of open yard with a structure
// selected clears the selection and the combine set.
//
// HOW IT IS DECIDED. Select a structure, press on empty yard, and read the
// selection and the set back. The evidence it hands back is `cleared` (image):
// the cleared selection.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-clears-selection", () => {
  it("A press on empty yard clears the selection", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-clears-selection` has not been written yet",
    );
  });
});
