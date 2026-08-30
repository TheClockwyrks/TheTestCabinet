// Arc Foundry — `effects.leak-alarm`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `effects/leak-alarm.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Particles are drawn at the collector on the frame a unit
// grounds out that were not drawn there on the frame before it.
//
// HOW IT IS DECIDED. Walk a unit into the collector and sample the collector
// either side. The evidence it hands back is `leak` (replay): the surge at the
// collector.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("effects.leak-alarm", () => {
  it("A leak surges at the collector", () => {
    fail(
      "a validator deciding this point",
      "the suite for `effects.leak-alarm` has not been written yet",
    );
  });
});
