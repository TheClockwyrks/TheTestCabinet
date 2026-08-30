// Arc Foundry — `status-bar.maze-length`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/maze-length.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The status bar draws the current maze length in tiles, and
// the drawn figure changes on the frame a placement or a dismantle changes the
// route, with no advance in between.
//
// HOW IT IS DECIDED. Read the drawn figure, place a wall across a leg, and
// read it again without advancing. The evidence it hands back is `bar`
// (image): the bar's maze length following a placement.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.maze-length", () => {
  it("The bar draws the maze length and follows it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.maze-length` has not been written yet",
    );
  });
});
