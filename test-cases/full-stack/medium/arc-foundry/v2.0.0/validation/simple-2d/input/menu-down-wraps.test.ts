// Arc Foundry — `input.menu-down-wraps`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/menu-down-wraps.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On a menu the down action moves the highlight down by one
// entry, and from the last entry it wraps to the first.
//
// HOW IT IS DECIDED. Open a menu, take the down action from a middle entry and
// again from the last, and read menuIndex. The evidence it hands back is
// `wrap` (image): the highlight wrapping to the first entry.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.menu-down-wraps", () => {
  it("The down action moves the highlight and wraps", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.menu-down-wraps` has not been written yet",
    );
  });
});
