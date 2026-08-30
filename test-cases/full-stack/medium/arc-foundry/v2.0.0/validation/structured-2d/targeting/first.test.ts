// Arc Foundry — `targeting.first`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/first.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With several units in range at different points of the
// chain, a structure set to first fires at the one furthest along by the
// progress ordering of specs/pathing.md.
//
// HOW IT IS DECIDED. Park frozen units at known checkpoints in range, set
// first, fire once, and read the projectile's target. The evidence it hands
// back is `first` (replay): the first target selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.first", () => {
  it("first selects the unit furthest along the chain", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.first` has not been written yet",
    );
  });
});
