// Arc Foundry — `sprites.blocker-sprite`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/blocker-sprite.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/blocker.png exists as a 40 by 40 PNG.
//
// HOW IT IS DECIDED. Read the file and decode its dimensions. The evidence it
// hands back is `blocker` (image): the produced blocker on the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.blocker-sprite", () => {
  it("The blocker is produced", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.blocker-sprite` has not been written yet",
    );
  });
});
