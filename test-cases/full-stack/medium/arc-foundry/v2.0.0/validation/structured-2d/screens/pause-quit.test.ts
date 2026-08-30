// Arc Foundry — `screens.pause-quit`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/pause-quit.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking QUIT TO MENU from the pause menu moves the screen to
// title.
//
// HOW IT IS DECIDED. Open the pause menu mid-run, take QUIT TO MENU, and read
// the screen. The evidence it hands back is `title` (image): the title
// returned to from a run.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.pause-quit", () => {
  it("QUIT TO MENU returns to the title", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.pause-quit` has not been written yet",
    );
  });
});
