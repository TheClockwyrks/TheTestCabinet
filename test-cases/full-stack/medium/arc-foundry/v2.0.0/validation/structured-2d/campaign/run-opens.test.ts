// Arc Foundry — `campaign.run-opens`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/run-opens.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Beginning a run opens the playing screen in a build phase
// with Charge at START_CHARGE (10), Grid Integrity at START_INTEGRITY (20),
// refinement 0, an empty yard, the wave counter at 0 and stampsLeft at 5.
//
// HOW IT IS DECIDED. Begin a run from the difficulty select and read the
// opening state. The evidence it hands back is `opening` (image): the opening
// build phase.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.run-opens", () => {
  it("A run opens on its first build phase", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.run-opens` has not been written yet",
    );
  });
});
