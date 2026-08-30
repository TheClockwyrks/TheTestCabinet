// Arc Foundry — `status-bar.wave-read`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/wave-read.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. During a wave the bar draws the wave number and the run's
// total, and during a build phase it draws a BUILD read instead.
//
// HOW IT IS DECIDED. Read the bar's text draws in a build phase and again
// during the wave it launches. The evidence it hands back is `bar` (image):
// the bar's wave read.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.wave-read", () => {
  it("The bar reads WAVE n / N during a wave and BUILD in a build phase", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.wave-read` has not been written yet",
    );
  });
});
