// Arc Foundry — `build-panel.refinement-control`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/refinement-control.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The panel draws the current refinement level and the Charge
// cost of the next level, and the control reports disabled at R8 and when the
// next level is unaffordable.
//
// HOW IT IS DECIDED. Read the control and its disabled flag at an affordable
// level, an unaffordable one and at R8. The evidence it hands back is
// `control` (image): the refinement control.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.refinement-control", () => {
  it("The refinement control shows the level and the next cost", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.refinement-control` has not been written yet",
    );
  });
});
