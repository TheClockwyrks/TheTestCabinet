// Arc Foundry — `audio.slow`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/slow.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The slow cue is played on the frame a slow is applied to a
// unit, and on no frame before it.
//
// HOW IT IS DECIDED. Land one Choke hit on a frozen unit and read the cues
// played on that frame. The evidence it hands back is `slow` (replay): the
// slow whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.slow", () => {
  it("The slow cue plays when a slow is applied", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.slow` has not been written yet",
    );
  });
});
