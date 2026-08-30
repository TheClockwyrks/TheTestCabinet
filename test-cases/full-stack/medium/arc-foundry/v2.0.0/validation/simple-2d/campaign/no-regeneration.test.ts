// Arc Foundry — `campaign.no-regeneration`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/no-regeneration.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Grid Integrity is unchanged across a wave cleared without a
// leak, across a build phase, across a refinement and across a combine, so
// nothing in the game returns it.
//
// HOW IT IS DECIDED. Drop Grid Integrity, then clear a wave and take each of
// the other actions, reading it back after each. The evidence it hands back is
// `steady` (replay): grid Integrity holding where a leak left it.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.no-regeneration", () => {
  it("Grid Integrity never regenerates", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.no-regeneration` has not been written yet",
    );
  });
});
