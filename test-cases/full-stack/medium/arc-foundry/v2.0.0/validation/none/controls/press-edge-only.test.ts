// Arc Foundry — `controls.press-edge-only`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/press-edge-only.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Holding a bound key down fires its action exactly once:
// with KeyF held for sixty frames the speed multiplier steps once, not sixty
// times.
//
// HOW IT IS DECIDED. Hold a bound key across many frames and count the times
// its action fired. The evidence it hands back is `edge` (image): the single
// step a held key produced.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.press-edge-only", () => {
  it("Every action but modify is read as a press edge", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.press-edge-only` has not been written yet",
    );
  });
});
