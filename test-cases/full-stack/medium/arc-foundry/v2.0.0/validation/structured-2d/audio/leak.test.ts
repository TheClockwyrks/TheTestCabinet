// Arc Foundry — `audio.leak`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/leak.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The leak cue is played on the frame a unit grounds out at
// the collector, and on no frame before it.
//
// HOW IT IS DECIDED. Walk a unit into the collector and read the cues played
// on that frame. The evidence it hands back is `leak` (replay): the leak whose
// cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.leak", () => {
  it("The leak cue plays when a unit grounds out", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.leak` has not been written yet",
    );
  });
});
