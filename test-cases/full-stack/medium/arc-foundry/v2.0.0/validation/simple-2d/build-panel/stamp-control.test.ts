// Arc Foundry — `build-panel.stamp-control`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `build-panel/stamp-control.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The panel draws STAMP with the stamps remaining, and the
// control reports disabled when the allowance is spent and during a wave.
//
// HOW IT IS DECIDED. Read the control and its disabled flag with stamps
// remaining, with none, and during a wave. The evidence it hands back is
// `control` (image): the stamp control and its allowance.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("build-panel.stamp-control", () => {
  it("The stamp control shows the allowance", () => {
    fail(
      "a validator deciding this point",
      "the suite for `build-panel.stamp-control` has not been written yet",
    );
  });
});
