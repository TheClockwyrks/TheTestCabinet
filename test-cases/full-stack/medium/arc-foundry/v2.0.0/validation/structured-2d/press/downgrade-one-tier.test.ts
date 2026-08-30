// Arc Foundry — `press.downgrade-one-tier`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/downgrade-one-tier.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Downgrading the selected candidate makes it a permanent
// component at one tier below the one it rolled, at the same type, and starts
// the wave the same way a keep does.
//
// HOW IT IS DECIDED. Arm a Charged roll, drop it, downgrade it, and read the
// resulting quality back. The evidence it hands back is `downgraded` (image):
// the component a downgrade produced.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.downgrade-one-tier", () => {
  it("DOWNGRADE harvests one quality tier lower", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.downgrade-one-tier` has not been written yet",
    );
  });
});
