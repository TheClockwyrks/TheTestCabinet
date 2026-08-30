// Arc Foundry — `quality.fire-rate-flat`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/fire-rate-flat.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A type's fire rate is the same at every tier: an Emitter
// reports 4.5 a second at Scrap and at Tesla-Prime, and fires the same number
// of shots over a counted interval at both.
//
// HOW IT IS DECIDED. Read the reported fire rate at both ends of the ladder
// and count the shots each fires over five seconds. The evidence it hands back
// is `cadence` (replay): the two tiers firing at one cadence.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.fire-rate-flat", () => {
  it("Cadence is flat across the ladder", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.fire-rate-flat` has not been written yet",
    );
  });
});
