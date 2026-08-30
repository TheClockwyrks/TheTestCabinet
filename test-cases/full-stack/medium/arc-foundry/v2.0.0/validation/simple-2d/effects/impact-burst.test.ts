// Arc Foundry — `effects.impact-burst`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/impact-burst.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn at the point a shot connects with a
// unit on the frame it connects that were not drawn there on the frame before
// it.
//
// HOW IT IS DECIDED. Sample the impact point either side of a Capacitor's hit.
// The evidence it hands back is `impact` (replay): the burst where a shot
// connects.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.impact-burst", () => {
  it("Any shot that connects bursts at the impact", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.impact-burst` has not been written yet",
    );
  });
});
