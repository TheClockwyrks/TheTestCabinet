// Arc Foundry — `audio.cue-once-per-frame`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/cue-once-per-frame.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A frame on which several units die plays the kill cue once,
// not once per unit, so a wave clearing does not stack the same sound.
//
// HOW IT IS DECIDED. Kill three frozen units on one frame and count the kill
// cues played on it. The evidence it hands back is `once` (replay): the frame
// that raised one cue three times.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.cue-once-per-frame", () => {
  it("A cue plays once on a frame that raises it several times", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.cue-once-per-frame` has not been written yet",
    );
  });
});
