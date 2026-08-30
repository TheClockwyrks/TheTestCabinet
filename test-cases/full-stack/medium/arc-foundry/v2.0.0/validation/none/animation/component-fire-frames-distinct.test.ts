// Arc Foundry — `animation.component-fire-frames-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/component-fire-frames-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Within each firing cycle the four frames are pairwise
// different images, so a firing structure visibly charges and discharges.
//
// HOW IT IS DECIDED. Decode each cycle's four frames and compare their pixels
// pairwise. The evidence it hands back is `cycle` (image): one firing cycle's
// four frames.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.component-fire-frames-distinct", () => {
  it("A firing cycle's four frames differ", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.component-fire-frames-distinct` has not been written yet",
    );
  });
});
