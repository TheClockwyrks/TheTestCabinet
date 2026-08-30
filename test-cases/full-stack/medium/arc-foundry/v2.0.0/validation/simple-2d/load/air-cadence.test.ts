// Arc Foundry — `load.air-cadence`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `load/air-cadence.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A wave whose number is a multiple of 4 carries Filaments,
// and no other wave carries one, across a whole run.
//
// HOW IT IS DECIDED. Play a run's waves through and record the type of every
// unit each wave released. The evidence it hands back is `air` (replay): a
// Filament wave arriving.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("load.air-cadence", () => {
  it("Filaments arrive every fourth wave and no other", () => {
    fail(
      "a validator deciding this point",
      "the suite for `load.air-cadence` has not been written yet",
    );
  });
});
