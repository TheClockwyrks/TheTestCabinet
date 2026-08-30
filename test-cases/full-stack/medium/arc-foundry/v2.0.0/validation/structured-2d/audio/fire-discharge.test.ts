// Arc Foundry — `audio.fire-discharge`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/fire-discharge.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The fire-discharge cue is played on the frame an Arc-Node
// or a Discharge Rig fires, and on no frame before it.
//
// HOW IT IS DECIDED. Fire each of the two types once and read the cues played
// on the frame of each shot. The evidence it hands back is `discharge`
// (replay): the discharge whose cue is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.fire-discharge", () => {
  it("The fire-discharge cue plays for an Arc-Node or a Discharge Rig", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.fire-discharge` has not been written yet",
    );
  });
});
