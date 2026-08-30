// Arc Foundry — `combos.lands-at-level-zero`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/lands-at-level-zero.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A newly assembled tower reports level 0, damage
// referenceDamage * COMBO_DAMAGE_MULT[0] (0.5) and range referenceRange +
// COMBO_RANGE_BONUS[0] (0), so a Fork Array lands at 50 damage and 118 range.
//
// HOW IT IS DECIDED. Assemble a tower and read its level, damage and range
// back. The evidence it hands back is `landed` (image): the tower at level 0.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.lands-at-level-zero", () => {
  it("A tower lands at level 0", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.lands-at-level-zero` has not been written yet",
    );
  });
});
