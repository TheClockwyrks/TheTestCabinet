// Arc Foundry — `audio.kill`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/kill.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The kill cue is played on the frame a unit dies, and on no
// frame before it.
//
// HOW IT IS DECIDED. Kill a frozen unit with one shot and read the cues played
// on that frame. The evidence it hands back is `kill` (replay): the kill whose
// cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.kill", () => {
  it("The kill cue plays when a unit dies", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.kill` has not been written yet",
    );
  });
});
