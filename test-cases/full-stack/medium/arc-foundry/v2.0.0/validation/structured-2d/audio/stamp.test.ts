// Arc Foundry — `audio.stamp`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/stamp.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The stamp cue is played on the frame a rock lands and
// rolls, and on no frame before it.
//
// HOW IT IS DECIDED. Drop a rock and read the cues played on that frame and
// the frames before it. The evidence it hands back is `stamp` (replay): the
// landing whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.stamp", () => {
  it("The stamp cue plays when a rock lands", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.stamp` has not been written yet",
    );
  });
});
