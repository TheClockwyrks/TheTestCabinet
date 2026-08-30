// Arc Foundry — `quality.combine-lands-at-initiator`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/combine-lands-at-initiator.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combine's result stands at the footprint of the piece the
// combine was initiated from, whichever ingredient that is, so a combine may
// replace a standing structure in place.
//
// HOW IT IS DECIDED. Fold the same pair twice, initiating from each piece in
// turn, and read the result's anchor. The evidence it hands back is `landed`
// (image): the fold landing on the initiating footprint.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.combine-lands-at-initiator", () => {
  it("The result lands on the initiating footprint", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.combine-lands-at-initiator` has not been written yet",
    );
  });
});
