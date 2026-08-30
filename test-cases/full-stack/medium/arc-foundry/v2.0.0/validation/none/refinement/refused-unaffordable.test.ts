// Arc Foundry — `refinement.refused-unaffordable`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/refused-unaffordable.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With less Charge than the next level costs, refining
// changes nothing: the level and the Charge are both unchanged and the panel's
// refinement control is disabled.
//
// HOW IT IS DECIDED. Set Charge one short of the next cost, attempt the
// refinement, and read the level and Charge back. The evidence it hands back
// is `refused` (image): the disabled refinement control.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.refused-unaffordable", () => {
  it("Refining is refused when it cannot be afforded", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.refused-unaffordable` has not been written yet",
    );
  });
});
