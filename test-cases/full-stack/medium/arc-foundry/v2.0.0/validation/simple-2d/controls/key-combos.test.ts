// Arc Foundry — `controls.key-combos`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-combos.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyV opens the recipe book and pressing it again
// dismisses it.
//
// HOW IT IS DECIDED. Press KeyV twice and read the overlays state after each.
// The evidence it hands back is `book` (image): the recipe book opened from
// the keyboard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-combos", () => {
  it("KeyV toggles the recipe book", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-combos` has not been written yet",
    );
  });
});
