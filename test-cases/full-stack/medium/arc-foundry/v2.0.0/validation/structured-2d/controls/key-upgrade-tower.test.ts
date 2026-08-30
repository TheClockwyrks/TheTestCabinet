// Arc Foundry — `controls.key-upgrade-tower`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-upgrade-tower.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyU with a combination tower selected and Charge
// banked raises that tower's level by one and spends its cost.
//
// HOW IT IS DECIDED. Assemble a tower, bank Charge, select it, press KeyU, and
// read the level and Charge. The evidence it hands back is `upgraded` (image):
// the tower the upgrade key raised.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-upgrade-tower", () => {
  it("KeyU raises the selected combination tower", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-upgrade-tower` has not been written yet",
    );
  });
});
