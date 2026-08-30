// Arc Foundry — `refinement.refused-at-max`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/refused-at-max.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At REFINEMENT_MAX (8) refining changes nothing, spends no
// Charge, and the panel's refinement control is disabled.
//
// HOW IT IS DECIDED. Set R8 with Charge banked, attempt the refinement, and
// read the level and Charge back. The evidence it hands back is `refused`
// (image): the refinement control at the top rung.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.refused-at-max", () => {
  it("Refining is refused at R8", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.refused-at-max` has not been written yet",
    );
  });
});
