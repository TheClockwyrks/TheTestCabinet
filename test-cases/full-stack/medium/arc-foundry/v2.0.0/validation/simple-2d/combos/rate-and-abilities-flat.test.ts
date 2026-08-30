// Arc Foundry — `combos.rate-and-abilities-flat`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/rate-and-abilities-flat.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A tower's fire rate and every ability parameter — a splash
// radius, a chain's leaps, leap range and falloff, a slow's amount and
// duration, a burn's fraction and duration, a crit's chance and multiplier, a
// multishot's N, an aura's radius and bonus — are identical at level 0 and
// level 3, so a tower scales through its damage alone.
//
// HOW IT IS DECIDED. Read every reported stat and ability parameter at both
// ends of the track. The evidence it hands back is `flat` (image): the tower's
// abilities unchanged across levels.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.rate-and-abilities-flat", () => {
  it("Cadence and ability parameters are flat across level", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.rate-and-abilities-flat` has not been written yet",
    );
  });
});
