// Arc Foundry — `campaign.bonus-independent-of-play`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/bonus-independent-of-play.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The same wave clear pays the same bonus whether the player
// is broke or sitting on a hoard, and whether the wave was killed off or
// leaked through, and banked Charge earns no interest over a build phase.
//
// HOW IT IS DECIDED. Clear the same wave twice from different Charge balances
// and different outcomes, and sit on a balance across a build phase. The
// evidence it hands back is `hoard` (replay): the same bonus paid over a
// hoard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.bonus-independent-of-play", () => {
  it("The bonus is a function of the wave alone", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.bonus-independent-of-play` has not been written yet",
    );
  });
});
