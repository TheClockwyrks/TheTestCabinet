// Arc Foundry — `controls.key-upgrade-press`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-upgrade-press.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyU with nothing selected, or with a base
// structure or a blocker selected, refines the press one level and spends its
// cost rather than doing nothing.
//
// HOW IT IS DECIDED. Bank Charge, select a base component, press KeyU, and
// read the refinement level. The evidence it hands back is `refined` (image):
// the press the upgrade key refined.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-upgrade-press", () => {
  it("KeyU refines the press when no tower is selected", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-upgrade-press` has not been written yet",
    );
  });
});
