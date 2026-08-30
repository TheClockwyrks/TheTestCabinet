// Arc Foundry — `audio.fire-chain`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/fire-chain.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The fire-chain cue is played on the frame a Coil fires, and
// on no frame before it.
//
// HOW IT IS DECIDED. Fire a Coil once and read the cues played on that frame.
// The evidence it hands back is `chain` (replay): the chain whose cue is
// checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.fire-chain", () => {
  it("The fire-chain cue plays for a Coil", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.fire-chain` has not been written yet",
    );
  });
});
