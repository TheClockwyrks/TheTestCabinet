// Arc Foundry — `abilities.rectifier-burn-rate`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `abilities/rectifier-burn-rate.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Rectifier's hit applies a burn of shotDamage *
// RECTIFIER_BURN_FRAC (0.5) per second, so a Charged Rectifier's 18 damage
// burns at 9 a second and the unit loses health at that rate, integrated
// against the update's delta time.
//
// HOW IT IS DECIDED. Hit a frozen unit once and sample its health each second
// of the burn. The evidence it hands back is `burn` (replay): the unit burning
// down.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("abilities.rectifier-burn-rate", () => {
  it("A Rectifier's burn removes half the shot per second", () => {
    fail(
      "a validator deciding this point",
      "the suite for `abilities.rectifier-burn-rate` has not been written yet",
    );
  });
});
