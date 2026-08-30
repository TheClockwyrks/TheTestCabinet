// Arc Foundry — `input.pointer-selects`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-selects.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing on a standing structure makes it the primary
// selection and clears the combine set back to that single selection.
//
// HOW IT IS DECIDED. Stand two structures, add both to the combine set, press
// on one, and read the selection and the set. The evidence it hands back is
// `select` (image): the structure the press selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-selects", () => {
  it("A press on a structure selects it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-selects` has not been written yet",
    );
  });
});
