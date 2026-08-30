// Arc Foundry — `audio.music`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/music.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The music cue is played from the first build phase onward
// and loops rather than ending: it is still sounding after a span longer than
// its own file's duration.
//
// HOW IT IS DECIDED. Begin a run and read the music cue's play and loop events
// across a span longer than the file. The evidence it hands back is `music`
// (replay): the run the music played under.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.music", () => {
  it("The music cue loops under the yard", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.music` has not been written yet",
    );
  });
});
