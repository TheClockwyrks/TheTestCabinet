// Arc Foundry — `audio.fire-spark`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `audio/fire-spark.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The fire-spark cue is played on the frame an Emitter fires,
// and on no frame before it.
//
// HOW IT IS DECIDED. Fire an Emitter once and read the cues played on that
// frame. The evidence it hands back is `spark` (replay): the spark whose cue
// is checked.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("audio.fire-spark", () => {
  it("The fire-spark cue plays for an Emitter", () => {
    fail(
      "a validator deciding this point",
      "the suite for `audio.fire-spark` has not been written yet",
    );
  });
});
