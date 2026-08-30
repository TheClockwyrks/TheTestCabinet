// Arc Foundry — `abilities.rectifier-burn-duration`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/rectifier-burn-duration.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The burn runs for RECTIFIER_BURN_DUR (2.0) seconds from the
// hit and then stops: the unit's health is unchanged over the five seconds
// after the burn expires.
//
// HOW IT IS DECIDED. Hit a frozen unit once, advance past the duration, and
// sample its health either side. The evidence it hands back is `expiry`
// (replay): the burn expiring.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.rectifier-burn-duration", () => {
  it("A burn runs RECTIFIER_BURN_DUR and stops", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.rectifier-burn-duration` has not been written yet",
    );
  });
});
