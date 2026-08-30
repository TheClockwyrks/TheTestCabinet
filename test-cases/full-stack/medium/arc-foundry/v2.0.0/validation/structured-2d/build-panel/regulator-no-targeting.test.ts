// Arc Foundry — `build-panel.regulator-no-targeting`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/regulator-no-targeting.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Regulator offers no targeting action at any tier, as a
// candidate or as a component, because it never fires and carries no priority.
//
// HOW IT IS DECIDED. Select a Regulator candidate and a Regulator component
// and read panelButtons back. The evidence it hands back is `panel` (image):
// the Regulator's inspector without a targeting slot.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.regulator-no-targeting", () => {
  it("A Regulator has no targeting control", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.regulator-no-targeting` has not been written yet",
    );
  });
});
