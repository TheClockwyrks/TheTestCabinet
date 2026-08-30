// Arc Foundry — `effects.death-burst`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/death-burst.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn where a unit dies on the frame it is
// removed that were not drawn there on the frame before it.
//
// HOW IT IS DECIDED. Kill a frozen unit with one shot and sample its position
// either side. The evidence it hands back is `death` (replay): the burst where
// a unit died.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.death-burst", () => {
  it("A dying unit pops", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.death-burst` has not been written yet",
    );
  });
});
