// Arc Foundry — `effects.spray-on-emitter`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/spray-on-emitter.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn between an Emitter's head and its
// target on the frame it fires that were not drawn there on the frame before
// it.
//
// HOW IT IS DECIDED. Sample the head's surroundings either side of an
// Emitter's shot. The evidence it hands back is `spray` (replay): the spark
// spray an Emitter throws.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.spray-on-emitter", () => {
  it("An Emitter throws a spark spray", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.spray-on-emitter` has not been written yet",
    );
  });
});
