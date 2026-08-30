// Arc Foundry — `effects.ring-at-impact`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/ring-at-impact.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn in an expanding ring centred on an Arc-
// Node's impact point on the frame its shot lands, covering the splash radius,
// and none are drawn there before it.
//
// HOW IT IS DECIDED. Sample a circle at the splash radius around the impact
// point either side of the hit. The evidence it hands back is `ring` (replay):
// the discharge ring at an Arc-Node's impact.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.ring-at-impact", () => {
  it("An Arc-Node's shot lands a discharge ring", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.ring-at-impact` has not been written yet",
    );
  });
});
