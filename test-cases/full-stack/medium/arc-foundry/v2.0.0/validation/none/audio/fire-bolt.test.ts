// Arc Foundry — `audio.fire-bolt`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/fire-bolt.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The fire-bolt cue is played on the frame a Capacitor, a
// Choke or a Rectifier fires, and on no frame before it.
//
// HOW IT IS DECIDED. Fire each of the three types once and read the cues
// played on the frame of each shot. The evidence it hands back is `bolt`
// (replay): the bolt whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.fire-bolt", () => {
  it("The fire-bolt cue plays for a Capacitor, a Choke or a Rectifier", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.fire-bolt` has not been written yet",
    );
  });
});
