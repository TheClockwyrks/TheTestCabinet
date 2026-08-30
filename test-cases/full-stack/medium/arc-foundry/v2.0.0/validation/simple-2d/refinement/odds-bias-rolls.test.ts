// Arc Foundry — `refinement.odds-bias-rolls`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `refinement/odds-bias-rolls.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At R8, over a long run of rolls at a fixed seed, no
// candidate rolls Scrap and every one of the other four tiers appears, so the
// table is what the press draws from rather than a display.
//
// HOW IT IS DECIDED. Set R8, roll several hundred rocks at a fixed seed, and
// count the qualities. The evidence it hands back is `rolls` (image): a yard
// of refined rolls.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("refinement.odds-bias-rolls", () => {
  it("The odds actually bias the roll", () => {
    fail(
      "a validator deciding this point",
      "the suite for `refinement.odds-bias-rolls` has not been written yet",
    );
  });
});
