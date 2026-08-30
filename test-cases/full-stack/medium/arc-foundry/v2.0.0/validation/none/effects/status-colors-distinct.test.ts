// Arc Foundry — `effects.status-colors-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/status-colors-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The mean color of the slow, burn and aura systems' color
// gradients are pairwise more than 60 of 441 apart in RGB distance, and each
// is more than 60 from the mean of the firing effects' gradients, so a player
// reads which effect is on a unit without reading a number.
//
// HOW IT IS DECIDED. Parse the twelve systems, average each one's color stops,
// and compare the three status colors against each other and against the
// firing effects. The evidence it hands back is `colors` (image): the three
// status effects on one unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.status-colors-distinct", () => {
  it("The slow, burn and aura effects carry colors of their own", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.status-colors-distinct` has not been written yet",
    );
  });
});
