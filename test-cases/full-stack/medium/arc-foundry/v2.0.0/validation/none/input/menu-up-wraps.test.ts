// Arc Foundry — `input.menu-up-wraps`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/menu-up-wraps.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On a menu the up action moves the highlight up by one
// entry, and from the first entry it wraps to the last.
//
// HOW IT IS DECIDED. Open a menu, take the up action from a middle entry and
// again from the first, and read menuIndex. The evidence it hands back is
// `wrap` (image): the highlight wrapping to the last entry.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.menu-up-wraps", () => {
  it("The up action moves the highlight and wraps", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.menu-up-wraps` has not been written yet",
    );
  });
});
