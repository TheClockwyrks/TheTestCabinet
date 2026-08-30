// Arc Foundry — `abilities.choke-slow-expires`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/choke-slow-expires.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. CHOKE_SLOW_DUR (1.2) seconds after the hit the unit's
// slowFactor returns to 1 and it moves at its base speed again.
//
// HOW IT IS DECIDED. Hit a travelling unit once, advance past the duration,
// and sample its speed either side of the expiry. The evidence it hands back
// is `expiry` (replay): the unit recovering its speed.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.choke-slow-expires", () => {
  it("A slow expires after CHOKE_SLOW_DUR", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.choke-slow-expires` has not been written yet",
    );
  });
});
