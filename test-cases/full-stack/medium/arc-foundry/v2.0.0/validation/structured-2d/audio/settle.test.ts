// Arc Foundry — `audio.settle`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/settle.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The settle cue is played on the frame the unharvested
// candidates harden into blockers at a wave's start, and on no frame before
// it.
//
// HOW IT IS DECIDED. Drop five rocks, keep one, and read the cues played on
// the harvest's frame. The evidence it hands back is `settle` (replay): the
// settling whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.settle", () => {
  it("The settle cue plays when candidates harden", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.settle` has not been written yet",
    );
  });
});
