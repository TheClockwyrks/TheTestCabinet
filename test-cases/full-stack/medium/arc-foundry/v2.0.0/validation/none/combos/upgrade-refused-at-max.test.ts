// Arc Foundry — `combos.upgrade-refused-at-max`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/upgrade-refused-at-max.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. At COMBO_MAX_LEVEL (3) upgrading changes nothing and spends
// no Charge, and the panel's upgrade control is disabled.
//
// HOW IT IS DECIDED. Set a tower to level 3 with Charge banked, attempt the
// upgrade, and read the level and Charge back. The evidence it hands back is
// `refused` (image): the upgrade control at the top of the track.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.upgrade-refused-at-max", () => {
  it("An upgrade is refused at level 3", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.upgrade-refused-at-max` has not been written yet",
    );
  });
});
