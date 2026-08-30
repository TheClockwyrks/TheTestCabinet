// Arc Foundry — `refinement.odds-table`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/odds-table.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At each of the nine refinement levels the reported
// qualityOdds equal that level's row of REFINEMENT_ODDS exactly, each row
// summing to 1, so R4 reads [0.40, 0.30, 0.20, 0.10, 0] and R8 reads [0, 0.30,
// 0.30, 0.30, 0.10].
//
// HOW IT IS DECIDED. Set each refinement level in turn and hold qualityOdds
// against the nine-row table. The evidence it hands back is `odds` (image):
// the panel's odds at a refined press.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.odds-table", () => {
  it("The live odds are REFINEMENT_ODDS[R]", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.odds-table` has not been written yet",
    );
  });
});
