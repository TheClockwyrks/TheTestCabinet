// Arc Foundry — `abilities.choke-slow-amount`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/choke-slow-amount.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Choke's hit sets the struck unit's slowFactor to 1 -
// CHOKE_SLOW[tier] — 0.22 at Scrap rising 0.03 a tier — so its reported speed
// becomes baseSpeed times that factor and it covers proportionally less
// ground.
//
// HOW IT IS DECIDED. Hit a travelling unit with a Choke at each tier and read
// its speed and the ground it covers. The evidence it hands back is `slow`
// (replay): the slowed unit crawling.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.choke-slow-amount", () => {
  it("A Choke's hit slows by CHOKE_SLOW", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.choke-slow-amount` has not been written yet",
    );
  });
});
