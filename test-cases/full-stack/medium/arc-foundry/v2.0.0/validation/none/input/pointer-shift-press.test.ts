// Arc Foundry — `input.pointer-shift-press`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-shift-press.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A shift press on a base structure adds it to the explicit
// combine set, and a second shift press on the same piece removes it.
//
// HOW IT IS DECIDED. Shift press one structure twice and read the combine set
// after each. The evidence it hands back is `set` (image): the combine set a
// shift press built.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-shift-press", () => {
  it("A shift press toggles a piece in the combine set", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-shift-press` has not been written yet",
    );
  });
});
