// Arc Foundry — `input.back-closes-pause`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-closes-pause.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On the paused screen the back action closes the pause menu
// and returns to playing.
//
// HOW IT IS DECIDED. Open the pause menu, take back, and read the screen. The
// evidence it hands back is `back` (image): the pause menu the back action
// closed.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-closes-pause", () => {
  it("back closes the pause menu", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-closes-pause` has not been written yet",
    );
  });
});
