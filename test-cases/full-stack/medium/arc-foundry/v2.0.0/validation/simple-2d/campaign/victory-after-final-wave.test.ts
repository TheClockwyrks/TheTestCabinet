// Arc Foundry — `campaign.victory-after-final-wave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/victory-after-final-wave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Clearing the final wave with Grid Integrity remaining puts
// the run into the finale phase rather than straight onto the victory screen,
// and the victory screen follows once the finale has run.
//
// HOW IT IS DECIDED. Drive a run to the final wave, clear it, and read the
// phase and then the screen. The evidence it hands back is `finale` (replay):
// the finale opening after the final wave.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.victory-after-final-wave", () => {
  it("Clearing wave N runs the finale, then victory", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.victory-after-final-wave` has not been written yet",
    );
  });
});
