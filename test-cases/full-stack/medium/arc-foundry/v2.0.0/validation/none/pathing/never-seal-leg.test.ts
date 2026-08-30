// Arc Foundry — `pathing.never-seal-leg`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/never-seal-leg.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A placement that would leave any leg of the chain, Entry to
// WP1 through WP6 to Collector, with no open route is refused and changes
// nothing: no structure lands, no stamp is spent, and the maze length is
// unchanged, while a legal placement elsewhere is accepted.
//
// HOW IT IS DECIDED. Wall a corridor down to its last open tile, attempt the
// sealing placement, and take an accepted placement beside it. The evidence it
// hands back is `refused` (image): the board after a refused seal and an
// accepted placement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.never-seal-leg", () => {
  it("A placement that would seal a leg is refused", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.never-seal-leg` has not been written yet",
    );
  });
});
