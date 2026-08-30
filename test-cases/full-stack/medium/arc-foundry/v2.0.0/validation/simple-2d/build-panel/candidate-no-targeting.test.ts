// Arc Foundry — `build-panel.candidate-no-targeting`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/candidate-no-targeting.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A candidate offers no targeting action at any type or tier:
// the action is absent from panelButtons rather than present and disabled,
// because a candidate does not fire.
//
// HOW IT IS DECIDED. Select candidates of several types and tiers and read
// panelButtons back. The evidence it hands back is `panel` (image): the
// candidate's inspector without a targeting slot.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.candidate-no-targeting", () => {
  it("A candidate has no targeting control", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.candidate-no-targeting` has not been written yet",
    );
  });
});
