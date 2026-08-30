// Arc Foundry — `combos.upgrade-refused-unaffordable`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `combos/upgrade-refused-unaffordable.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With less Charge than the next level costs, upgrading
// changes nothing: the level and the Charge are both unchanged and the panel's
// upgrade control is disabled.
//
// HOW IT IS DECIDED. Set Charge one short of the next cost, attempt the
// upgrade, and read the level and Charge back. The evidence it hands back is
// `refused` (image): the disabled upgrade control.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("combos.upgrade-refused-unaffordable", () => {
  it("An upgrade is refused when it cannot be afforded", () => {
    fail(
      "a validator deciding this point",
      "the suite for `combos.upgrade-refused-unaffordable` has not been written yet",
    );
  });
});
