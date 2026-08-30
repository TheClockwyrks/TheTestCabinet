// Arc Foundry — `screens.title`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/title.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. After reset the screen reads title with menuIndex 0, and
// the frame draws TITLE_TEXT (ARC FOUNDRY), TAGLINE_TEXT (GROUND THE LOAD) and
// every entry of TITLE_ITEMS, with the entry at the current index drawn
// distinctly from the others.
//
// HOW IT IS DECIDED. Reset to the title, read the text draws, and compare the
// highlighted entry's draw against the others. The evidence it hands back is
// `title` (image): the title screen.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.title", () => {
  it("The title screen draws its copy", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.title` has not been written yet",
    );
  });
});
