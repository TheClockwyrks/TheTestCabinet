// Arc Foundry — `effects.combine-flash`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/combine-flash.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn at the resulting structure's footprint
// on the frame a combine of either kind resolves that were not drawn there on
// the frame before it.
//
// HOW IT IS DECIDED. Sample the initiating footprint either side of a fold.
// The evidence it hands back is `flash` (replay): the flash at a resolving
// combine.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.combine-flash", () => {
  it("A combine flashes at the result", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.combine-flash` has not been written yet",
    );
  });
});
