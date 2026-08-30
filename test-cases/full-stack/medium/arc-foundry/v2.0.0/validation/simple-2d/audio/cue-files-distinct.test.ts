// Arc Foundry — `audio.cue-files-distinct`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/cue-files-distinct.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. No two of the eleven effect cue files are the same audio,
// so the events are told apart by ear rather than by one sound committed
// eleven times.
//
// HOW IT IS DECIDED. Decode the eleven files and compare their samples
// pairwise. The evidence it hands back is `run` (replay): the run the cues
// were played over.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.cue-files-distinct", () => {
  it("The eleven effect cues are eleven different sounds", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.cue-files-distinct` has not been written yet",
    );
  });
});
