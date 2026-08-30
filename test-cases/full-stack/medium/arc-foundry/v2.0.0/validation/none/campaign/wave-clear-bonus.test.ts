// Arc Foundry — `campaign.wave-clear-bonus`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/wave-clear-bonus.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Clearing wave n pays WAVE_BONUS_BASE + WAVE_BONUS_STEP * n
// in Charge, with WAVE_BONUS_BASE 8 and WAVE_BONUS_STEP 2, so wave 1 pays 10
// and wave 6 pays 20.
//
// HOW IT IS DECIDED. Clear several waves and read the Charge the clear paid at
// each. The evidence it hands back is `bonus` (replay): the bonus landing as
// the wave clears.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.wave-clear-bonus", () => {
  it("Clearing a wave pays its flat bonus", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.wave-clear-bonus` has not been written yet",
    );
  });
});
