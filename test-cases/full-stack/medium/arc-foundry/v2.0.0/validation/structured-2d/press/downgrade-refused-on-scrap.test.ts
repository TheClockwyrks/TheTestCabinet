// Arc Foundry — `press.downgrade-refused-on-scrap`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `press/downgrade-refused-on-scrap.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A Scrap candidate cannot be downgraded: the action changes
// nothing, no component is harvested, and no wave starts.
//
// HOW IT IS DECIDED. Arm a Scrap roll, drop it, attempt a downgrade, and read
// the phase and the structure back. The evidence it hands back is `refused`
// (image): the Scrap candidate a downgrade refused.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("press.downgrade-refused-on-scrap", () => {
  it("DOWNGRADE is refused on a Scrap candidate", () => {
    fail(
      "a validator deciding this point",
      "the suite for `press.downgrade-refused-on-scrap` has not been written yet",
    );
  });
});
