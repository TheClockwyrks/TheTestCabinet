// Arc Foundry — `controls.key-targeting`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-targeting.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyT with a firing structure selected steps its
// priority through first, last, nearest, strongest, weakest and back to first,
// one step per press.
//
// HOW IT IS DECIDED. Select a firing structure and press KeyT six times,
// reading the priority after each. The evidence it hands back is `cycle`
// (image): the priority cycling through the five.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-targeting", () => {
  it("KeyT cycles the targeting priority", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-targeting` has not been written yet",
    );
  });
});
