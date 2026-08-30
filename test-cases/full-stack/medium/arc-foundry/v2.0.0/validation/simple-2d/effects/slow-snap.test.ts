// Arc Foundry — `effects.slow-snap`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/slow-snap.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn on a unit on the frame a slow is
// applied to it that were not drawn there on the frame before it.
//
// HOW IT IS DECIDED. Apply a slow to a frozen unit and sample it either side.
// The evidence it hands back is `slow` (replay): the snap clinging to a slowed
// unit.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.slow-snap", () => {
  it("A slow snaps on the unit that carries it", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.slow-snap` has not been written yet",
    );
  });
});
