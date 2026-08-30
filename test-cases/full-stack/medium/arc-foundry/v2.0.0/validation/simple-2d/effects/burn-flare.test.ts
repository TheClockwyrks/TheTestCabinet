// Arc Foundry — `effects.burn-flare`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/burn-flare.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn on a unit on the frame a burn is
// applied to it that were not drawn there on the frame before it.
//
// HOW IT IS DECIDED. Apply a burn to a frozen unit and sample it either side.
// The evidence it hands back is `burn` (replay): the flare on a burning unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.burn-flare", () => {
  it("A burn flares on the unit that carries it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.burn-flare` has not been written yet",
    );
  });
});
