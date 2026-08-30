// Arc Foundry — `sprites.icon-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/icon-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/icons/charge.png, integrity.png and type-<type>.png
// for each of the eight base types each exist as a 16 by 16 PNG.
//
// HOW IT IS DECIDED. Read the ten files and decode each one's dimensions. The
// evidence it hands back is `icons` (image): the produced icons in the bar and
// the panel.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.icon-sprites", () => {
  it("The status and panel icons are produced", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.icon-sprites` has not been written yet",
    );
  });
});
