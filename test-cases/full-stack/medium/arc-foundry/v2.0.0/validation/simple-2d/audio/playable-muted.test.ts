// Arc Foundry — `audio.playable-muted`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/playable-muted.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. With the mute bit engaged the same drive reaches the same
// state as an unmuted one — the same snapshot after the same calls and the
// same elapsed simulation — so nothing about the game depends on the audio
// being audible.
//
// HOW IT IS DECIDED. Drive the same scenario muted and unmuted from the same
// seed and compare the two snapshots. The evidence it hands back is `muted`
// (replay): the run driven with sound muted.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.playable-muted", () => {
  it("The game plays identically with sound muted", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.playable-muted` has not been written yet",
    );
  });
});
