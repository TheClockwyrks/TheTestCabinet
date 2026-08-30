// Arc Foundry — `combos.range-by-level`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/range-by-level.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A tower's range is referenceRange +
// COMBO_RANGE_BONUS[level], with COMBO_RANGE_BONUS [0, 4, 8, 12], at each of
// the four levels.
//
// HOW IT IS DECIDED. Set a tower to each level in turn and hold the reported
// range against the table. The evidence it hands back is `levels` (image): the
// tower's reach across its track.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.range-by-level", () => {
  it("Range follows COMBO_RANGE_BONUS", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.range-by-level` has not been written yet",
    );
  });
});
