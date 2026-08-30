// Arc Foundry — `status-bar.charge`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/charge.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With Charge posed to a known figure, the status bar draws
// that figure, and the drawn figure changes when Charge changes.
//
// HOW IT IS DECIDED. Pose two different Charge figures and read the bar's text
// draws after each. The evidence it hands back is `bar` (image): the bar
// reading the run's Charge.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.charge", () => {
  it("The bar draws the current Charge", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.charge` has not been written yet",
    );
  });
});
