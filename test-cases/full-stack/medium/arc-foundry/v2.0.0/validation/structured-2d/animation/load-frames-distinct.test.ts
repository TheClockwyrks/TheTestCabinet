// Arc Foundry — `animation.load-frames-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/load-frames-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Within each Load type's cycle the four frames are pairwise
// different images, so the unit visibly crackles rather than holding one pose.
//
// HOW IT IS DECIDED. Decode each cycle's four frames and compare their pixels
// pairwise. The evidence it hands back is `cycle` (image): one Load cycle's
// four frames.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.load-frames-distinct", () => {
  it("A Load cycle's four frames differ", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.load-frames-distinct` has not been written yet",
    );
  });
});
