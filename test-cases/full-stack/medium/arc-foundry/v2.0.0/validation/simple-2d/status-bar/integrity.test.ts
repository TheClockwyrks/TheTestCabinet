// Arc Foundry — `status-bar.integrity`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/integrity.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With Grid Integrity posed to a known figure, the status bar
// draws that figure, and the drawn figure changes when Grid Integrity changes.
//
// HOW IT IS DECIDED. Pose two different Grid Integrity figures and read the
// bar's text draws after each. The evidence it hands back is `bar` (image):
// the bar reading Grid Integrity.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.integrity", () => {
  it("The bar draws the remaining Grid Integrity", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.integrity` has not been written yet",
    );
  });
});
