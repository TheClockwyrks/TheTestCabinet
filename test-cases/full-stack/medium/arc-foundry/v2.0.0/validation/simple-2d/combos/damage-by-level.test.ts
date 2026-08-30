// Arc Foundry — `combos.damage-by-level`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/damage-by-level.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A tower's damage is referenceDamage *
// COMBO_DAMAGE_MULT[level], with COMBO_DAMAGE_MULT [0.5, 0.63, 0.78, 1.02], at
// each of the four levels.
//
// HOW IT IS DECIDED. Set a tower to each level in turn and hold the reported
// damage against the table. The evidence it hands back is `levels` (image):
// the tower's damage across its track.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.damage-by-level", () => {
  it("Damage follows COMBO_DAMAGE_MULT", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.damage-by-level` has not been written yet",
    );
  });
});
