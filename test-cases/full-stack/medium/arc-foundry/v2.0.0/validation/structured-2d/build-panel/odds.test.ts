// Arc Foundry — `build-panel.odds`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/odds.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The panel draws the five-tier roll odds at the live
// refinement level, and the drawn figures change when the refinement level
// changes.
//
// HOW IT IS DECIDED. Read the panel's text draws at two refinement levels. The
// evidence it hands back is `odds` (image): the panel's odds at a refined
// press.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.odds", () => {
  it("The panel draws the live quality odds", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.odds` has not been written yet",
    );
  });
});
