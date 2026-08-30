// Arc Foundry — `input.pointer-right-press`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/pointer-right-press.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A right press while holding a rock puts it away, spending
// no stamp and placing nothing.
//
// HOW IT IS DECIDED. Arm a rock, right press, and read the held state and
// stampsLeft. The evidence it hands back is `away` (image): the rock put away
// by a right press.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.pointer-right-press", () => {
  it("A right press puts a held rock away", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.pointer-right-press` has not been written yet",
    );
  });
});
