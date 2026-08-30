// Arc Foundry — `audio.combine`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/combine.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The combine cue is played on the frame a combine of either
// kind resolves, quality fold and recipe alike, and on no frame before it.
//
// HOW IT IS DECIDED. Commit a quality fold and a recipe fold and read the cues
// played on each resolving frame. The evidence it hands back is `combine`
// (replay): the fold whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.combine", () => {
  it("The combine cue plays when a fold resolves", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.combine` has not been written yet",
    );
  });
});
