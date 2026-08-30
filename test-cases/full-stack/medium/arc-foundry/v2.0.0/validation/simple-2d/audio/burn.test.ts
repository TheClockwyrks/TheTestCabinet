// Arc Foundry — `audio.burn`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/burn.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The burn cue is played on the frame a burn is applied to a
// unit, and on no frame before it.
//
// HOW IT IS DECIDED. Land one Rectifier hit on a frozen unit and read the cues
// played on that frame. The evidence it hands back is `burn` (replay): the
// burn whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.burn", () => {
  it("The burn cue plays when a burn is applied", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.burn` has not been written yet",
    );
  });
});
