// Arc Foundry — `input.pointer-modify-press`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-modify-press.test.ts`, so
// the declaration resolves and the point is named in every grade. The suite
// itself is still to be written, and until it is this file fails loudly rather
// than passing a build it never checked.
//
// THE REQUIREMENT. A press on a base structure made while the modify action is
// held adds it to the explicit combine set, and a second such press on the
// same piece removes it.
//
// HOW IT IS DECIDED. Hold the modify key, press one structure twice, and read
// the combine set after each. The evidence it hands back is `set` (image): the
// combine set a modified press built.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-modify-press", () => {
  it("A press with modify held toggles a piece in the combine set", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-modify-press` has not been written yet",
    );
  });
});
