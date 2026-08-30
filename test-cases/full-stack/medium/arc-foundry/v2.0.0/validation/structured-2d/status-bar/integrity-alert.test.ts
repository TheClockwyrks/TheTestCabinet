// Arc Foundry — `status-bar.integrity-alert`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/integrity-alert.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Grid Integrity read is drawn differently once the
// figure falls to INTEGRITY_ALERT (5) or below: the pixels sampled inside its
// region at 6 and at 5 differ by more than 50 of 441 in RGB distance.
//
// HOW IT IS DECIDED. Pose Grid Integrity at 6 and at 5 and sample the region
// the figure is drawn in. The evidence it hands back is `alert` (image): the
// Grid Integrity read in alert.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.integrity-alert", () => {
  it("Grid Integrity reads as an alert at five or below", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.integrity-alert` has not been written yet",
    );
  });
});
