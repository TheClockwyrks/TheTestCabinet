// Arc Foundry — `input.back-opens-pause`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `input/back-opens-pause.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With nothing held, nothing selected and no overlay open,
// the back action on playing opens the pause menu.
//
// HOW IT IS DECIDED. Clear the yard state, take back on playing, and read the
// screen. The evidence it hands back is `back` (image): the pause menu the
// back action opened.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("input.back-opens-pause", () => {
  it("back opens the pause menu on playing", () => {
    fail(
      "a validator deciding this point",
      "the suite for `input.back-opens-pause` has not been written yet",
    );
  });
});
