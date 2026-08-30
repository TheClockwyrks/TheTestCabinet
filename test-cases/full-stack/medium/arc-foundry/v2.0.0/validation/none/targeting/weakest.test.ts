// Arc Foundry — `targeting.weakest`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/weakest.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure set to weakest fires at the in-range unit
// carrying the least remaining health.
//
// HOW IT IS DECIDED. Park the same units, set weakest, fire once, and read the
// projectile's target. The evidence it hands back is `weakest` (replay): the
// weakest target selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.weakest", () => {
  it("weakest selects the unit with the least health", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.weakest` has not been written yet",
    );
  });
});
