// Arc Foundry — `audio.cue-files-present`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/cue-files-present.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/audio/<cue>.wav exists for all twelve cue names and
// decodes as PCM audio carrying a non-silent sample, and
// assets/audio/music.mid is committed beside the music cue's own file.
//
// HOW IT IS DECIDED. Read the thirteen files, decode each wav, and measure its
// peak amplitude. The evidence it hands back is `run` (replay): the run the
// cues were played over.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.cue-files-present", () => {
  it("The twelve cue files are produced", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.cue-files-present` has not been written yet",
    );
  });
});
