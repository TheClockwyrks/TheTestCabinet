// Arc Foundry — `controls.key-pause`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-pause.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing Space on playing engages the in-place pause and
// pressing it again releases it, with the screen reading playing throughout.
//
// HOW IT IS DECIDED. Press Space twice mid-wave and read paused and the screen
// after each. The evidence it hands back is `pause` (image): the in-place
// pause toggled from the keyboard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-pause", () => {
  it("Space toggles the in-place pause", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-pause` has not been written yet",
    );
  });
});
