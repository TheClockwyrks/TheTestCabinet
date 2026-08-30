// Arc Foundry — `targeting.last`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/last.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With the same units in range, a structure set to last fires
// at the one least far along by that same ordering.
//
// HOW IT IS DECIDED. Park the same units, set last, fire once, and read the
// projectile's target. The evidence it hands back is `last` (replay): the last
// target selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.last", () => {
  it("last selects the unit least far along the chain", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.last` has not been written yet",
    );
  });
});
