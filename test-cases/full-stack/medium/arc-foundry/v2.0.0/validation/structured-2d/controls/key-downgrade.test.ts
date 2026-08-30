// Arc Foundry — `controls.key-downgrade`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-downgrade.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyG with a candidate at Tuned or above selected
// harvests it one quality tier lower.
//
// HOW IT IS DECIDED. Select a Charged candidate, press KeyG, and read the
// resulting quality. The evidence it hands back is `downgraded` (image): the
// component the downgrade key harvested.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-downgrade", () => {
  it("KeyG harvests one tier lower", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-downgrade` has not been written yet",
    );
  });
});
