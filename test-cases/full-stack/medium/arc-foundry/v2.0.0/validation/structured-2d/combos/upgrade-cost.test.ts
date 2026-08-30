// Arc Foundry — `combos.upgrade-cost`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/upgrade-cost.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Raising a tower one level spends round(referenceDamage *
// COMBO_UPGRADE_COST_FRAC[level - 1]) Charge, with the three fractions 0.8,
// 1.5 and 2.8, so the three upgrades of a Static Web at 34 reference damage
// cost 27, 51 and 95.
//
// HOW IT IS DECIDED. Bank enough Charge, raise a tower through all three
// levels, and read the Charge spent at each. The evidence it hands back is
// `cost` (image): the Charge each upgrade spent.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.upgrade-cost", () => {
  it("An upgrade costs its fraction of the reference damage", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.upgrade-cost` has not been written yet",
    );
  });
});
