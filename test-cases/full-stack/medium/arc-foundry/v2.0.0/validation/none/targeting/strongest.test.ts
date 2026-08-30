// Arc Foundry — `targeting.strongest`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `targeting/strongest.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A structure set to strongest fires at the in-range unit
// carrying the most remaining health.
//
// HOW IT IS DECIDED. Park frozen units posed to known healths, set strongest,
// fire once, and read the projectile's target. The evidence it hands back is
// `strongest` (replay): the strongest target selected.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("targeting.strongest", () => {
  it("strongest selects the unit with the most health", () => {
    fail(
      "a validator deciding this point",
      "the suite for `targeting.strongest` has not been written yet",
    );
  });
});
