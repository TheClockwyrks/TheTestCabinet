// Arc Foundry — `animation.press-cycle`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `animation/press-cycle.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/press/0.png through 3.png exist and the four frames
// are pairwise different images.
//
// HOW IT IS DECIDED. Read the four files and compare their pixels pairwise.
// The evidence it hands back is `press` (image): the press's produced cycle.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("animation.press-cycle", () => {
  it("The press has a four-frame stamping cycle", () => {
    fail(
      "a validator deciding this point",
      "the suite for `animation.press-cycle` has not been written yet",
    );
  });
});
