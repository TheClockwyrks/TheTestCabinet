// Arc Foundry — `quality.harvest-combine-starts-wave`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `quality/harvest-combine-starts-wave.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A combine consuming at least one candidate is the level's
// harvest: it resolves, the remaining candidates harden, and the wave begins.
//
// HOW IT IS DECIDED. Roll a matching candidate beside a standing component,
// fold them, and read the phase and the other candidates back. The evidence it
// hands back is `harvest` (replay): the wave a harvest combine launched.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("quality.harvest-combine-starts-wave", () => {
  it("A combine that consumes a candidate is the harvest", () => {
    fail(
      "a validator deciding this point",
      "the suite for `quality.harvest-combine-starts-wave` has not been written yet",
    );
  });
});
