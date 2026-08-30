// Arc Foundry — `difficulty.nothing-else-changes`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `difficulty/nothing-else-changes.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The starting Charge, the starting Grid Integrity, the stamp
// allowance, the refinement odds and costs, the bounties, the leak values, the
// wave-clear bonus, the component stats and the recipes are identical at all
// three difficulties.
//
// HOW IT IS DECIDED. Open a run at each difficulty and compare every one of
// those figures across the three. The evidence it hands back is `same`
// (image): the same economy under three difficulties.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("difficulty.nothing-else-changes", () => {
  it("Difficulty changes nothing but waves and toughness", () => {
    fail(
      "a validator deciding this point",
      "the suite for `difficulty.nothing-else-changes` has not been written yet",
    );
  });
});
