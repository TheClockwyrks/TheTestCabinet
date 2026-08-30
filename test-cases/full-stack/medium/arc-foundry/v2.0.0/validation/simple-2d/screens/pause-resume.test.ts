// Arc Foundry — `screens.pause-resume`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/pause-resume.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking RESUME from the pause menu moves the screen back to
// playing and leaves paused false, even when the in-place pause was engaged
// before the menu opened.
//
// HOW IT IS DECIDED. Engage the in-place pause, open the pause menu, take
// RESUME, and read the screen and paused back. The evidence it hands back is
// `resume` (image): the run resumed from the pause menu.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.pause-resume", () => {
  it("RESUME returns to playing and clears the in-place pause", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.pause-resume` has not been written yet",
    );
  });
});
