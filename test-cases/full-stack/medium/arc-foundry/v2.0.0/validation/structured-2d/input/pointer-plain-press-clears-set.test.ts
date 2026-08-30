// Arc Foundry — `input.pointer-plain-press-clears-set`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at
// `input/pointer-plain-press-clears-set.test.ts`, so the declaration resolves
// and the point is named in every grade. The suite itself is still to be
// written, and until it is this file fails loudly rather than passing a build
// it never checked.
//
// THE REQUIREMENT. A press on a base structure made with the modify action
// released clears the explicit combine set back to that single selection,
// however many pieces the set held.
//
// HOW IT IS DECIDED. Build a combine set of several pieces with modify held,
// then press one of them with modify released and read the set back. The
// evidence it hands back is `cleared` (image): the combine set an unmodified
// press cleared.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-plain-press-clears-set", () => {
  it("A press with modify released clears the combine set", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-plain-press-clears-set` has not been written yet",
    );
  });
});
