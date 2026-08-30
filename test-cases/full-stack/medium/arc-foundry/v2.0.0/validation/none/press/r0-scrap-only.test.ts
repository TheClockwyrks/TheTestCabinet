// Arc Foundry — `press.r0-scrap-only`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/r0-scrap-only.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At refinement 0 every rolled candidate is quality 1, over a
// long run of rolls, and the reported qualityOdds are [1, 0, 0, 0, 0].
//
// HOW IT IS DECIDED. Roll a long run at refinement 0 and read every rolled
// quality. The evidence it hands back is `scrap` (image): a yard of Scrap
// rolls.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.r0-scrap-only", () => {
  it("At R0 the press rolls Scrap alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.r0-scrap-only` has not been written yet",
    );
  });
});
