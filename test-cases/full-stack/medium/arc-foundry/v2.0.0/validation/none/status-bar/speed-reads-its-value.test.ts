// Arc Foundry — `status-bar.speed-reads-its-value`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/speed-reads-its-value.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The pixels inside the speed control's reported rectangle
// differ between multiplier 1 and multiplier 8, so the control reads its value
// rather than merely being clickable.
//
// HOW IT IS DECIDED. Sample the control's rectangle at each multiplier and
// compare. The evidence it hands back is `speed` (image): the speed control at
// two multipliers.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.speed-reads-its-value", () => {
  it("The speed control draws its live value", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.speed-reads-its-value` has not been written yet",
    );
  });
});
